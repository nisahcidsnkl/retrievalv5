# -*- coding: utf-8 -*-
"""
Batch extract DINOv3 features for multi-year tiles (z=18) and insert into PostgreSQL (pgvector).

New behavior:
- Support multi-year data: 2023/2025 (tiles/YYYY/18/*)
- Insert data_year into table tile_patch_xiaoshan
- DINOv3 patch tokens: 14x14 (196)
- Sliding window on token grid: WIN=5, STRIDE=3 -> 4x4 windows = 16 vectors
- Table schema: tile_patch_xiaoshan(dataset_id, z, x, y, patch_id, model_id, data_year, data_month, embedding vector(1024))

Assumptions:
- tiles path: ./tiles/{year}/18/{col}/{row}.png (year=2023/2025)
- dataset_id = 0, z = 18, model_id = 0
- patch_id: row-major 0..15 (top->bottom, left->right)
- data_month: None (can be modified if needed)
- DINOv3 last_hidden_state has 201 tokens: 5 prefix + 196 patch tokens
"""

import os
import time
from typing import List, Tuple, Dict

import torch
import torch.nn.functional as F
from PIL import Image
from transformers import AutoImageProcessor, AutoModel

import psycopg2
from psycopg2.extras import execute_values
from pgvector.psycopg2 import register_vector  # pip install pgvector


# ===================== 配置区 =====================
# 1) 数据集 - 支持多年份配置
TILES_ROOT = './tiles'  # 根路径
TARGET_YEARS = [2023, 2025]  # 目标年份列表
Z_LEVEL = 18  # 18级影像
DATASET_ID = 0
MODEL_ID = 0
DATA_MONTH = None  # 月份（无则设为None，可根据需求修改）

# 2) 模型
PRETRAINED_MODEL_DIR = "./dinov3-vitl16-pretrain-sat493m"
PATCH_SIZE = 16            # ViT-L/16
NUM_PREFIX_TOKENS = 5      # CLS(1) + register(4)

# 3) 滑窗参数
WIN = 5
STRIDE = 3

# 4) Pooling
P_GEM = 3.0
EPS = 1e-6

# 5) 入库与批处理
BATCH_INSERT_ROWS = 16 * 200  # 每 tile 16 行；每批 ~200 tiles
COMMIT_EVERY = 1

# 6) 数据库连接（改成你自己的）
PG = dict(
    host="127.0.0.1",
    port=5432,
    dbname="searchV5",
    user="postgres",
    password="123456",
)

# 7) 设备
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
# =================================================


def gem_pool_tokens_signed(x: torch.Tensor, p: float = 3.0, eps: float = 1e-6) -> torch.Tensor:
    """
    Signed-safe GeM pooling over a token window.
    Args:
        x: [B, C, win_h, win_w] (can be signed)
    Returns:
        pooled: [B, C]
    """
    w = x.abs().clamp_min(eps)                        # [B,C,wh,ww]
    numer = (x * w.pow(p - 1.0)).sum(dim=(-1, -2))    # [B,C]
    denom = w.pow(p).sum(dim=(-1, -2)).clamp_min(eps) # [B,C]
    return numer / denom


def list_multi_year_tiles(root: str, years: List[int], z_level: int) -> List[Tuple[int, int, int, str]]:
    """
    遍历多年份瓦片目录，格式：{root}/{year}/{z}/{col}/{row}.png
    返回: [(year, x(col), y(row), filepath), ...]
    """
    tiles = []
    for year in years:
        year_z_root = os.path.join(root, str(year), str(z_level))
        if not os.path.isdir(year_z_root):
            print(f"Warning: 年份{year}的{z_level}级瓦片目录不存在: {year_z_root}")
            continue

        # 遍历列目录
        for col_name in os.listdir(year_z_root):
            col_dir = os.path.join(year_z_root, col_name)
            if not os.path.isdir(col_dir) or not col_name.isdigit():
                continue
            x = int(col_name)

            # 遍历行文件
            for fn in os.listdir(col_dir):
                if not fn.lower().endswith(".png"):
                    continue
                row_name = os.path.splitext(fn)[0]
                if not row_name.isdigit():
                    continue
                y = int(row_name)
                fp = os.path.join(col_dir, fn)
                tiles.append((year, x, y, fp))

    # 按年份、列、行排序
    tiles.sort(key=lambda t: (t[0], t[1], t[2]))
    return tiles


@torch.inference_mode()
def extract_16x1024(model, processor, image: Image.Image) -> torch.Tensor:
    """
    输入单张 PIL RGB 图，输出 [16, 1024]（float32 on CPU）
    14x14 token grid -> 4x4 windows (WIN=5, STRIDE=3)
    """
    inputs = processor(images=image, return_tensors="pt")
    inputs = {k: v.to(model.device) for k, v in inputs.items()}

    outputs = model(**inputs)
    fine_output = outputs.last_hidden_state           # [1, 201, 1024]
    patch_tokens = fine_output[:, NUM_PREFIX_TOKENS:, :]  # [1, 196, 1024]

    H, W = inputs["pixel_values"].shape[-2:]
    gh, gw = H // PATCH_SIZE, W // PATCH_SIZE        # expected 14x14 if H=W=224
    if gh * gw != patch_tokens.shape[1]:
        raise ValueError(
            f"patch token mismatch: gh*gw={gh*gw}, tokens={patch_tokens.shape[1]}, HxW={H}x{W}"
        )

    # [1,196,1024] -> [1,1024,gh,gw]
    patch_grid = patch_tokens.view(1, gh, gw, -1).permute(0, 3, 1, 2).contiguous()

    if gh < WIN or gw < WIN:
        raise ValueError(f"token grid too small for WIN={WIN}: grid={gh}x{gw}")

    ys = list(range(0, gh - WIN + 1, STRIDE))
    xs = list(range(0, gw - WIN + 1, STRIDE))

    # 期待 4x4=16
    if len(ys) != 4 or len(xs) != 4:
        raise ValueError(f"window count != 4x4. got {len(ys)}x{len(xs)} from grid {gh}x{gw}")

    feats = []
    # row-major：y 外层（上到下），x 内层（左到右） -> patch_id 0..15
    for y0 in ys:
        for x0 in xs:
            window = patch_grid[:, :, y0:y0 + WIN, x0:x0 + WIN]      # [1,1024,WIN,WIN]
            feat = gem_pool_tokens_signed(window, p=P_GEM, eps=EPS)  # [1,1024]
            feats.append(feat)

    feats = torch.cat(feats, dim=0)          # [16,1024]
    feats = F.normalize(feats, dim=-1)       # L2 normalize
    return feats.detach().to(torch.float32).cpu()


def main():
    print(f"Device: {DEVICE}")
    print(f"Target years: {TARGET_YEARS}")
    print(f"Tiles root: {TILES_ROOT}, z-level: {Z_LEVEL}")

    # 1) 加载模型
    processor = AutoImageProcessor.from_pretrained(PRETRAINED_MODEL_DIR)
    model = AutoModel.from_pretrained(
        PRETRAINED_MODEL_DIR,
        use_safetensors=True,
        device_map="auto" if DEVICE.startswith("cuda") else None,
    )
    model.eval()
    print(f"Model device: {model.device}")

    # 2) 连接数据库（注册vector类型）
    conn = psycopg2.connect(**PG)
    register_vector(conn)
    cur = conn.cursor()

    # 3) 列出所有年份的tiles
    tiles = list_multi_year_tiles(TILES_ROOT, TARGET_YEARS, Z_LEVEL)
    print(f"Found {len(tiles)} tiles in years {TARGET_YEARS}.")
    if not tiles:
        print("Error: No tiles found!")
        return

    # 4) SQL（适配tile_patch_xiaoshan表结构，新增data_year/data_month）
    insert_sql = """
        INSERT INTO tile_patch_xiaoshan (dataset_id, z, x, y, patch_id, model_id, data_year, data_month, embedding)
        VALUES %s
        ON CONFLICT (dataset_id, z, x, y, patch_id, model_id, data_year) DO UPDATE
        SET embedding = EXCLUDED.embedding, data_month = EXCLUDED.data_month
    """

    rows_buffer = []
    n_ok = 0
    n_fail = 0
    year_stats: Dict[int, int] = {y: 0 for y in TARGET_YEARS}  # 按年份统计成功数
    t0 = time.time()

    for idx, (year, x, y, fp) in enumerate(tiles, 1):
        try:
            img = Image.open(fp).convert("RGB")          # tile 原图一般是 256x256
            feats_16 = extract_16x1024(model, processor, img)  # [16,1024] CPU float32

            # 每个patch对应一行，新增data_year/data_month字段
            for patch_id in range(16):
                emb = feats_16[patch_id].tolist()        # list[float] len=1024
                rows_buffer.append((
                    DATASET_ID, Z_LEVEL, x, y, patch_id, MODEL_ID,
                    year, DATA_MONTH, emb  # 核心：加入年份和月份
                ))

            n_ok += 1
            year_stats[year] += 1

        except Exception as e:
            n_fail += 1
            print(f"[FAIL] {fp} (year={year}, x={x}, y={y}) -> {e}")

        # 批量入库
        if len(rows_buffer) >= BATCH_INSERT_ROWS:
            execute_values(cur, insert_sql, rows_buffer, page_size=1000)
            if COMMIT_EVERY:
                conn.commit()
            rows_buffer.clear()

        # 进度打印
        if idx % 200 == 0:
            dt = time.time() - t0
            speed = idx / dt if dt > 0 else 0.0
            print(f"[{idx}/{len(tiles)}] ok={n_ok} fail={n_fail} speed={speed:.2f} tiles/s")
            print(f"Year stats: {year_stats}")

    # 处理剩余数据
    if rows_buffer:
        execute_values(cur, insert_sql, rows_buffer, page_size=1000)
        conn.commit()
        rows_buffer.clear()

    # 关闭连接
    cur.close()
    conn.close()

    # 最终统计
    dt = time.time() - t0
    print("\n===== Final Stats =====")
    print(f"Total tiles processed: {len(tiles)}")
    print(f"Success: {n_ok}, Failed: {n_fail}")
    print(f"Year breakdown: {year_stats}")
    print(f"Total time: {dt:.1f}s, Avg speed: {n_ok/dt if dt>0 else 0:.2f} tiles/s")


if __name__ == "__main__":
    main()