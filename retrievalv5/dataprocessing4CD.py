# -*- coding: utf-8 -*-
"""
Batch calculate embedding difference (2023 - 2025) for tiles (z=18)
and insert diff vector into PostgreSQL (pgvector).

Core Logic:
1. Extract embeddings for 2023/2025 tiles (same x/y/patch_id)
2. L2 normalize each embedding separately (before difference)
3. Calculate diff = 2023_emb (normalized) - 2025_emb (normalized)
4. Insert diff into tile_patch_emdiff_2023_2025
"""

import os
import time
import warnings
from typing import List, Tuple, Dict

import torch
import torch.nn.functional as F
from PIL import Image
from transformers import AutoImageProcessor, AutoModel

import psycopg2
from psycopg2.extras import execute_values
from pgvector.psycopg2 import register_vector  # pip install pgvector

# ===================== 配置区 =====================
# 1) 数据集 - 前/后时相配置（2023=前时相，2025=后时相）
TILES_ROOT = "./tiles"  # 根路径
PRE_YEAR = 2023  # 前时相（被减数）
POST_YEAR = 2025  # 后时相（减数）
Z_LEVEL = 18  # 18级影像
DATASET_ID = 0
MODEL_ID = 0

# 2) 模型
PRETRAINED_MODEL_DIR = "./dinov3-vitl16-pretrain-sat493m"
PATCH_SIZE = 16  # ViT-L/16
NUM_PREFIX_TOKENS = 5  # CLS(1) + register(4)

# 3) 滑窗参数
WIN = 5
STRIDE = 3

# 4) Pooling
P_GEM = 3.0
EPS = 1e-6

# 5) 入库与批处理
BATCH_INSERT_ROWS = 16 * 200  # 每tile 16个patch，每批≈200个tile
COMMIT_EVERY = 1

# 6) 数据库连接
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

# 关闭冗余警告
warnings.filterwarnings("ignore")
warnings.filterwarnings(
    "ignore",
    message=".*Torch was not compiled with flash attention.*",
    module="transformers.integrations.sdpa_attention"
)


def gem_pool_tokens_signed(x: torch.Tensor, p: float = 3.0, eps: float = 1e-6) -> torch.Tensor:
    """Signed-safe GeM pooling over a token window (保留原逻辑)"""
    w = x.abs().clamp_min(eps)  # [B,C,wh,ww]
    numer = (x * w.pow(p - 1.0)).sum(dim=(-1, -2))  # [B,C]
    denom = w.pow(p).sum(dim=(-1, -2)).clamp_min(eps)  # [B,C]
    return numer / denom


def list_tiles(year: int) -> List[Tuple[int, int, str]]:
    """遍历指定年份的瓦片：tiles/{year}/18/{col}/{row}.png，返回[(x,y,filepath), ...]"""
    tile_root = os.path.join(TILES_ROOT, str(year), str(Z_LEVEL))
    tiles = []
    if not os.path.isdir(tile_root):
        raise FileNotFoundError(f"Tiles root for year {year} not found: {tile_root}")

    for col_name in os.listdir(tile_root):
        col_dir = os.path.join(tile_root, col_name)
        if not os.path.isdir(col_dir) or not col_name.isdigit():
            continue
        x = int(col_name)

        for fn in os.listdir(col_dir):
            if not fn.lower().endswith(".png"):
                continue
            row_name = os.path.splitext(fn)[0]
            if not row_name.isdigit():
                continue
            y = int(row_name)
            fp = os.path.join(col_dir, fn)
            tiles.append((x, y, fp))

    tiles.sort(key=lambda t: (t[0], t[1]))
    return tiles


def get_tile_filepath(year: int, x: int, y: int) -> str:
    """根据年份和x/y坐标获取瓦片路径"""
    return os.path.join(TILES_ROOT, str(year), str(Z_LEVEL), str(x), f"{y}.png")


@torch.inference_mode()
def extract_normalized_feats(model, processor, image: Image.Image) -> torch.Tensor:
    """
    输入单张PIL RGB图，输出[16, 1024]归一化特征向量（CPU float32）
    步骤：提取特征 → L2归一化（满足“先归一化再求差”要求）
    """
    inputs = processor(images=image, return_tensors="pt")
    inputs = {k: v.to(model.device) for k, v in inputs.items()}

    outputs = model(**inputs)
    fine_output = outputs.last_hidden_state  # [1, 201, 1024]
    patch_tokens = fine_output[:, NUM_PREFIX_TOKENS:, :]  # [1, 196, 1024]

    H, W = inputs["pixel_values"].shape[-2:]
    gh, gw = H // PATCH_SIZE, W // PATCH_SIZE
    if gh * gw != patch_tokens.shape[1]:
        raise ValueError(f"Patch token mismatch: gh*gw={gh * gw}, tokens={patch_tokens.shape[1]}")

    # 重塑为特征网格
    patch_grid = patch_tokens.view(1, gh, gw, -1).permute(0, 3, 1, 2).contiguous()

    if gh < WIN or gw < WIN:
        raise ValueError(f"Token grid too small for WIN={WIN}: grid={gh}x{gw}")

    # 计算滑窗坐标
    ys = list(range(0, gh - WIN + 1, STRIDE))
    xs = list(range(0, gw - WIN + 1, STRIDE))
    if len(ys) != 4 or len(xs) != 4:
        raise ValueError(f"Window count != 4x4. got {len(ys)}x{len(xs)}")

    # 提取每个滑窗的特征
    feats = []
    for y0 in ys:
        for x0 in xs:
            window = patch_grid[:, :, y0:y0 + WIN, x0:x0 + WIN]
            feat = gem_pool_tokens_signed(window, p=P_GEM, eps=EPS)
            feats.append(feat)

    feats = torch.cat(feats, dim=0)  # [16, 1024]
    feats = F.normalize(feats, dim=-1)  # 关键：先L2归一化
    return feats.detach().to(torch.float32).cpu()


def main():
    print(f"Device: {DEVICE}")
    print(f"Calculating diff: {PRE_YEAR} (pre) - {POST_YEAR} (post) (normalized first)")
    print(f"Tiles root: {TILES_ROOT}, z-level: {Z_LEVEL}")

    # 1) 加载模型
    try:
        processor = AutoImageProcessor.from_pretrained(PRETRAINED_MODEL_DIR)
        model = AutoModel.from_pretrained(
            PRETRAINED_MODEL_DIR,
            use_safetensors=True,
            device_map="auto" if DEVICE.startswith("cuda") else None,
        )
        model.eval()
        print(f"Model loaded successfully (device: {model.device})")
    except Exception as e:
        print(f"Model load failed: {e}")
        return

    # 2) 连接数据库
    try:
        conn = psycopg2.connect(**PG)
        register_vector(conn)  # 注册pgvector类型
        cur = conn.cursor()
        print("Database connected successfully!")
    except Exception as e:
        print(f"Database connection failed: {e}")
        return

    # 3) 获取基准瓦片列表（仅处理两年都存在的瓦片）
    try:
        pre_tiles = list_tiles(PRE_YEAR)
        post_tiles = list_tiles(POST_YEAR)
        # 构建2025年瓦片的x/y到路径的映射
        post_tile_map = {(x, y): fp for x, y, fp in post_tiles}
        # 筛选出两年都存在的瓦片
        common_tiles = [(x, y, pre_fp) for x, y, pre_fp in pre_tiles if (x, y) in post_tile_map]
        print(f"Found {len(pre_tiles)} tiles in {PRE_YEAR}, {len(post_tiles)} tiles in {POST_YEAR}")
        print(f"Common tiles (both years exist): {len(common_tiles)}")

        if len(common_tiles) == 0:
            print("Error: No common tiles between two years!")
            cur.close()
            conn.close()
            return
    except Exception as e:
        print(f"Failed to list tiles: {e}")
        cur.close()
        conn.close()
        return

    # 4) SQL（适配tile_patch_emdiff_2023_2025表结构，仅插入diff向量）
    insert_sql = """
        INSERT INTO tile_patch_emdiff_2023_2025
        (dataset_id, z, x, y, patch_id, model_id, diff)
        VALUES %s
        ON CONFLICT (dataset_id, z, x, y, model_id, patch_id) DO UPDATE
        SET diff = EXCLUDED.diff
    """

    # 5) 批量处理+入库
    rows_buffer = []
    n_ok = 0
    n_fail = 0
    t0 = time.time()

    for idx, (x, y, pre_fp) in enumerate(common_tiles, 1):
        try:
            # 读取前时相（2023）瓦片并提取归一化特征
            img_pre = Image.open(pre_fp).convert("RGB")
            feats_pre = extract_normalized_feats(model, processor, img_pre)  # [16,1024] 已归一化

            # 读取后时相（2025）瓦片并提取归一化特征
            post_fp = post_tile_map[(x, y)]
            img_post = Image.open(post_fp).convert("RGB")
            feats_post = extract_normalized_feats(model, processor, img_post)  # [16,1024] 已归一化

            # 计算差值：前时相 - 后时相（2023 - 2025）
            feats_diff = feats_pre - feats_post  # [16, 1024]

            # 准备入库数据（每个patch_id对应一条记录）
            for patch_id in range(16):
                diff_emb = feats_diff[patch_id].tolist()
                rows_buffer.append((
                    DATASET_ID, Z_LEVEL, x, y, patch_id, MODEL_ID,
                    diff_emb  # 仅插入差值向量
                ))

            n_ok += 1

        except Exception as e:
            n_fail += 1
            print(f"[FAIL] Tile ({x},{y}) -> {str(e)[:100]}")

        # 批量入库
        if len(rows_buffer) >= BATCH_INSERT_ROWS:
            try:
                execute_values(cur, insert_sql, rows_buffer, page_size=1000)
                if COMMIT_EVERY:
                    conn.commit()
                rows_buffer.clear()
            except Exception as e:
                print(f"Batch insert failed: {str(e)[:100]}")
                conn.rollback()
                rows_buffer.clear()

        # 进度打印
        if idx % 200 == 0:
            dt = time.time() - t0
            speed = idx / dt if dt > 0 else 0.0
            print(f"[{idx}/{len(common_tiles)}] ok={n_ok} fail={n_fail} speed={speed:.2f} tiles/s")

    # 处理剩余数据
    if rows_buffer:
        try:
            execute_values(cur, insert_sql, rows_buffer, page_size=1000)
            conn.commit()
        except Exception as e:
            print(f"Final batch insert failed: {str(e)[:100]}")
            conn.rollback()

    # 6) 收尾
    cur.close()
    conn.close()

    # 最终统计
    dt = time.time() - t0
    print("\n===== Processing Summary =====")
    print(f"Total common tiles: {len(common_tiles)}")
    print(f"Successfully processed: {n_ok} tiles")
    print(f"Failed: {n_fail} tiles")
    print(f"Total time: {dt:.1f}s, avg speed: {n_ok / dt if dt > 0 else 0:.2f} tiles/s")


if __name__ == "__main__":
    main()