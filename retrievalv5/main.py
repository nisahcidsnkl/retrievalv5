import os
import sys
import io
import math
import base64
import logging
import traceback
import itertools
import httpx
import json
import uuid
from typing import List, Dict, Any, Tuple, Optional
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import torch
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fastapi import FastAPI, HTTPException, Body, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from transformers import AutoImageProcessor, AutoModel
import asyncpg
from shapely.geometry import box, mapping
from shapely.ops import unary_union


# ==================== 配置管理 ====================
class Settings(BaseSettings):
    # 数据库
    PG_HOST: str
    PG_PORT: int
    PG_DB: str
    PG_USER: str
    PG_PASSWORD: str

    # 业务ID
    DATASET_ID: int = 0
    MODEL_ID: int = 0
    ACTIVE_TABLE: str = "tile_patch_xiaoshan"

    # 路径
    MODEL_CKPT_PATH: str
    TILES_ROOT: str
    SAMPLES_ROOT: str = "./examples"  # 样本保存路径
    MASKS_ROOT: str = "./masks"  # 掩码保存路径

    # 系统
    DEVICE: str = "cuda:0"
    DEBUG: bool = True
    PORT: int = 5007

    TDT_BROWSER_TK: str = ""
    TDT_SERVER_TK: str

    # 默认年份配置
    DEFAULT_YEAR: int = 2025
    DEFAULT_ZOOM: int = 18

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

# ==================== 创建样本目录 ====================
os.makedirs(settings.SAMPLES_ROOT, exist_ok=True)
os.makedirs(settings.MASKS_ROOT, exist_ok=True)

# ==================== 滑窗配置逻辑 ====================
DINO_GRID_SIZE = 14
TILE_PIXEL_SIZE = 256
PIXELS_PER_GRID = TILE_PIXEL_SIZE / DINO_GRID_SIZE

PATCH_CONFIGS = {
    "tile_patch_xiaoshan": {
        "rows": 4,
        "cols": 4,
        "win": 5,
        "stride": 3,
        "table_name": "tile_patch_xiaoshan"
    }
}

if settings.ACTIVE_TABLE not in PATCH_CONFIGS:
    raise ValueError(f"配置文件中的 ACTIVE_TABLE 必须是 {list(PATCH_CONFIGS.keys())} 之一")

CURRENT_CONFIG = PATCH_CONFIGS[settings.ACTIVE_TABLE]
FEATURE_DIM = 1024
PATCH_SIZE = 64


# ==================== Pydantic模型 ====================
class PolygonRequest(BaseModel):
    polygon: List[List[float]]
    zoom: int = 18
    tile_size: int = 256
    output_size: int = 256
    year: Optional[int] = None


class SearchRequest(BaseModel):
    features: List[float]
    top_n: int = 100
    year: Optional[int] = None
    month: Optional[int] = None


class GeocodeRequest(BaseModel):
    q: str


class ExtractFeaturesRequest(BaseModel):
    image_base64: str
    mask_base64: Optional[str] = None
    year: Optional[int] = None


class YearSearchRequest(BaseModel):
    features: List[float]
    year: int
    top_n: int = 100
    month: Optional[int] = None


class ChangeDetectionRequest(BaseModel):
    image1_base64: str
    image2_base64: str
    mask_base64: Optional[str] = None
    year1: int
    month1: Optional[int] = None
    year2: int
    month2: Optional[int] = None
    top_n: int = 100
    top_k: int = 20
    min_similarity: float = 0.5


class MultiYearSearchRequest(BaseModel):
    features: List[float]
    years: List[int]
    top_n: int = 50
    month: Optional[int] = None


# 样本上传请求模型
class UploadSampleRequest(BaseModel):
    name: str
    tag: str
    image_base64: str
    mask_base64: Optional[str] = None
    roi_points: Optional[List[Dict[str, int]]] = None
    description: Optional[str] = ""


class SaveSampleRequest(BaseModel):
    name: str
    image_base64: str
    mask_base64: Optional[str] = None
    year: Optional[int] = None
    phase: str = "single"  # single, before, after
    tags: List[str] = []
    roi_points: Optional[List[Dict[str, int]]] = None
    coordinates: Optional[List[List[float]]] = None


class SaveROISampleRequest(BaseModel):
    polygon: List[List[float]]
    name: str
    year: int
    phase: str = "single"
    tags: List[str] = []


class SampleInfo(BaseModel):
    id: str
    name: str
    image_path: str
    mask_path: Optional[str] = None
    year: Optional[int] = None
    phase: str
    tags: List[str]
    created_at: str
    features: Optional[List[float]] = None
    roi_points: Optional[List[Dict[str, int]]] = None
    coordinates: Optional[List[List[float]]] = None

# 新增4变化检测
class ChangeDetectionBySamplesRequest(BaseModel):
    sample_id1: str  # 前时相样本ID
    sample_id2: str  # 后时相样本ID
    year1: int       # 前时相年份
    year2: int       # 后时相年份
    top_n: int = 1000 # 候选数量
    min_similarity: float = 0.3  # 最小相似度阈值

class ChangeDetectionBySamplesResponse(BaseModel):
    status: str
    targets: List[Dict[str, Any]]
    message: str
    total_patches: int = 0
    total_targets: int = 0


class TagRequest(BaseModel):
    name: str


class RenameRequest(BaseModel):
    name: str


# ==================== 全局变量 ====================
model = None
processor = None
db_pool = None


# ==================== 日志工具 ====================
def setup_logger():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        stream=sys.stdout
    )
    return logging.getLogger(__name__)


logger = setup_logger()


def normalize_features(features: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(features)
    if norm > 0:
        return features / norm
    else:
        return features


def _strip_data_url_prefix(b64: str) -> str:
    if not b64:
        return b64
    if "," in b64 and b64.strip().startswith("data:"):
        return b64.split(",", 1)[1]
    return b64


def base64_to_pil_image(b64: str, mode: str = "RGB") -> Image.Image:
    try:
        b64 = _strip_data_url_prefix(b64)
        raw = base64.b64decode(b64)
        img = Image.open(io.BytesIO(raw))
        img.load()
        return img.convert(mode)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"base64图片解码失败: {str(e)}")


def ensure_256x256(img: Image.Image, name: str) -> None:
    if img.size != (256, 256):
        raise HTTPException(status_code=400, detail=f"{name} 尺寸必须为 256x256，当前: {img.size}")


# ==================== 样本管理工具 ====================
class SampleManager:
    def __init__(self, samples_root: str, masks_root: str):
        self.samples_root = Path(samples_root)
        self.masks_root = Path(masks_root)
        self.samples_info_path = self.samples_root / "samples_info.json"
        self.samples_info = self._load_samples_info()

    def _load_samples_info(self) -> Dict[str, Dict]:
        """加载样本信息"""
        if self.samples_info_path.exists():
            try:
                with open(self.samples_info_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"加载样本信息失败: {str(e)}")
                return {}
        return {}

    def _save_samples_info(self):
        """保存样本信息"""
        try:
            with open(self.samples_info_path, 'w', encoding='utf-8') as f:
                json.dump(self.samples_info, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存样本信息失败: {str(e)}")

    def save_sample(self, sample_id: str, name: str, image_base64: str,
                    mask_base64: Optional[str] = None, year: Optional[int] = None,
                    phase: str = "single", tags: List[str] = [],
                    roi_points: Optional[List[Dict[str, int]]] = None,
                    coordinates: Optional[List[List[float]]] = None,
                    features: Optional[List[float]] = None) -> str:
        """保存样本"""
        try:
            # 创建目录
            phase_dir = self.samples_root / phase
            phase_dir.mkdir(exist_ok=True)
            mask_phase_dir = self.masks_root / phase
            mask_phase_dir.mkdir(exist_ok=True)

            # 保存图片
            image_data = base64.b64decode(_strip_data_url_prefix(image_base64))
            image_path = phase_dir / f"{sample_id}.png"
            with open(image_path, 'wb') as f:
                f.write(image_data)

            # 保存掩码
            mask_path = None
            if mask_base64:
                mask_data = base64.b64decode(_strip_data_url_prefix(mask_base64))
                mask_path = mask_phase_dir / f"{sample_id}.png"
                with open(mask_path, 'wb') as f:
                    f.write(mask_data)

            # 保存样本信息
            sample_info = {
                "id": sample_id,
                "name": name,
                "image_path": str(image_path.relative_to(self.samples_root)),
                "mask_path": str(mask_path.relative_to(self.masks_root)) if mask_path else None,
                "year": year,
                "phase": phase,
                "tags": tags,
                "features": features,
                "roi_points": roi_points,
                "coordinates": coordinates,
                "created_at": datetime.now().isoformat()
            }

            self.samples_info[sample_id] = sample_info
            self._save_samples_info()

            return sample_id

        except Exception as e:
            logger.error(f"保存样本失败: {str(e)}")
            raise HTTPException(status_code=500, detail=f"保存样本失败: {str(e)}")

    def get_sample(self, sample_id: str) -> Optional[Dict]:
        """获取样本信息"""
        return self.samples_info.get(sample_id)

    def get_samples_by_phase(self, phase: str) -> List[Dict]:
        """按相位获取样本"""
        return [info for info in self.samples_info.values() if info["phase"] == phase]

    def get_samples_with_roi_by_phase(self, phase: str) -> List[Dict]:
        """按相位获取有ROI的样本"""
        samples = self.get_samples_by_phase(phase)
        return [s for s in samples if s.get("roi_points")]

    def get_samples_by_year(self, year: int) -> List[Dict]:
        """按年份获取样本"""
        return [info for info in self.samples_info.values() if info.get("year") == year]

    def get_all_samples(self) -> List[Dict]:
        """获取所有样本"""
        return list(self.samples_info.values())

    def delete_sample(self, sample_id: str) -> bool:
        """删除样本"""
        if sample_id not in self.samples_info:
            return False

        try:
            # 删除图片文件
            sample_info = self.samples_info[sample_id]
            image_path = self.samples_root / sample_info["image_path"]
            if image_path.exists():
                image_path.unlink()

            # 删除掩码文件
            if sample_info.get("mask_path"):
                mask_path = self.masks_root / sample_info["mask_path"]
                if mask_path.exists():
                    mask_path.unlink()

            # 删除样本信息
            del self.samples_info[sample_id]
            self._save_samples_info()

            return True

        except Exception as e:
            logger.error(f"删除样本失败: {str(e)}")
            return False

    def search_samples(self, phase: Optional[str] = None, year: Optional[int] = None,
                       tags: Optional[List[str]] = None) -> List[Dict]:
        """搜索样本"""
        results = self.get_all_samples()

        if phase:
            results = [s for s in results if s["phase"] == phase]

        if year is not None:
            results = [s for s in results if s.get("year") == year]

        if tags:
            results = [s for s in results if any(tag in s.get("tags", []) for tag in tags)]

        return results


# ==================== 数据库管理工具 ====================
class DatabaseManager:

    @staticmethod
    async def search_similar_by_diff(query_diff_vector: List[float], limit: int,
                                     year_before: int, year_after: int) -> List[Dict[str, Any]]:
        """根据特征差检索相似变化"""
        if not db_pool:
            raise RuntimeError("数据库未连接")

        # 根据年份构建表名
        table_name = f"tile_patch_emdiff_{year_before}_{year_after}"

        # 检查表是否存在
        async with db_pool.acquire() as conn:
            table_exists = await conn.fetchval(
                "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
                table_name
            )

            if not table_exists:
                logger.warning(f"特征差表 {table_name} 不存在")
                return []

        # 配置参数（与tile_patch_xiaoshan表保持一致）
        rows = 4
        cols = 4
        win = 5
        stride = 3

        sql = f"""
                SELECT 
                    z, x, y, patch_id,
                    1 - (diff <=> $1) as similarity
                FROM {table_name}
                WHERE dataset_id = $2 AND model_id = $3
                ORDER BY diff <=> $1 ASC
                LIMIT $4;
            """

        try:
            async with db_pool.acquire() as conn:
                async with conn.transaction():
                    # 设置HNSW搜索参数
                    ef = min(max(limit * 2, limit, 100), 1000)
                    await conn.execute(f"SET LOCAL hnsw.ef_search = {ef};")

                    rows_result = await conn.fetch(
                        sql,
                        str(query_diff_vector),
                        settings.DATASET_ID,
                        settings.MODEL_ID,
                        limit
                    )

            logger.info(f"特征差检索返回: {len(rows_result)} 条 (表: {table_name})")

            results = []
            for row in rows_result:
                patch_id = row['patch_id']
                patch_row = patch_id // cols
                patch_col = patch_id % cols

                results.append({
                    "col": row['x'],
                    "row": row['y'],
                    "patch_col": patch_col,
                    "patch_row": patch_row,
                    "similarity": float(row['similarity']),
                    "z": row['z'],
                    "year_before": year_before,
                    "year_after": year_after,
                    "key": f"{row['z']}_{row['x']}_{row['y']}_{patch_col}_{patch_row}"
                })

            return results
        except Exception as e:
            logger.error(f"特征差检索失败: {str(e)}\n{traceback.format_exc()}")
            return []
    @staticmethod
    async def init_pool():
        global db_pool
        try:
            logger.info(f"正在连接数据库 {settings.PG_HOST}:{settings.PG_PORT}...")
            db_pool = await asyncpg.create_pool(
                host=settings.PG_HOST,
                port=settings.PG_PORT,
                user=settings.PG_USER,
                password=settings.PG_PASSWORD,
                database=settings.PG_DB,
                min_size=5,
                max_size=20
            )
            logger.info(f"数据库连接池创建成功，当前模式: {settings.ACTIVE_TABLE}")
        except Exception as e:
            logger.error(f"数据库连接失败: {str(e)}")
            raise

    @staticmethod
    async def close_pool():
        global db_pool
        if db_pool:
            await db_pool.close()

    @staticmethod
    async def get_feature_count(year: Optional[int] = None) -> int:
        if not db_pool:
            return 0
        try:
            table_name = CURRENT_CONFIG["table_name"]
            async with db_pool.acquire() as conn:
                if year is not None:
                    count = await conn.fetchval(
                        f"SELECT count(*) FROM {table_name} WHERE dataset_id = $1 AND model_id = $2 AND data_year = $3",
                        settings.DATASET_ID, settings.MODEL_ID, year
                    )
                else:
                    count = await conn.fetchval(
                        f"SELECT count(*) FROM {table_name} WHERE dataset_id = $1 AND model_id = $2",
                        settings.DATASET_ID, settings.MODEL_ID
                    )
                return count
        except Exception as e:
            logger.error(f"获取数量失败: {str(e)}")
            return 0

    @staticmethod
    async def get_available_years() -> List[int]:
        if not db_pool:
            return []
        try:
            table_name = CURRENT_CONFIG["table_name"]
            async with db_pool.acquire() as conn:
                rows = await conn.fetch(
                    f"SELECT DISTINCT data_year FROM {table_name} WHERE dataset_id = $1 AND model_id = $2 ORDER BY data_year",
                    settings.DATASET_ID, settings.MODEL_ID
                )
                return [row['data_year'] for row in rows]
        except Exception as e:
            logger.error(f"获取年份列表失败: {str(e)}")
            return []

    @staticmethod
    async def search_similar_vectors(query_vector: List[float], limit: int,
                                     year: Optional[int] = None, month: Optional[int] = None) -> List[Dict[str, Any]]:
        if not db_pool:
            raise RuntimeError("数据库未连接")

        table_name = CURRENT_CONFIG["table_name"]
        cols_per_row = CURRENT_CONFIG["cols"]

        conditions = ["dataset_id = $1", "model_id = $2"]
        params = [settings.DATASET_ID, settings.MODEL_ID]
        param_idx = 3

        if year is not None:
            conditions.append(f"data_year = ${param_idx}")
            params.append(year)
            param_idx += 1

        if month is not None:
            conditions.append(f"data_month = ${param_idx}")
            params.append(month)
            param_idx += 1

        where_clause = " AND ".join(conditions)

        sql = f"""
            SELECT 
                z, x, y, patch_id, data_year, data_month,
                1 - (embedding <=> ${param_idx}) as similarity
            FROM {table_name}
            WHERE {where_clause}
            ORDER BY embedding <=> ${param_idx} ASC
            LIMIT ${param_idx + 1};
        """

        params.extend([str(query_vector), limit])

        try:
            async with db_pool.acquire() as conn:
                async with conn.transaction():
                    ef = min(max(limit * 2, limit, 40), 1000)
                    await conn.execute(f"SET LOCAL hnsw.ef_search = {ef};")

                    rows = await conn.fetch(sql, *params)

            logger.info(f"HNSW检索返回: {len(rows)} 条 (year={year}, month={month})")

            results = []
            for row in rows:
                patch_id = row['patch_id']
                patch_row = patch_id // cols_per_row
                patch_col = patch_id % cols_per_row

                col = row['x']
                tile_row = row['y']

                results.append({
                    "col": col,
                    "row": tile_row,
                    "patch_col": patch_col,
                    "patch_row": patch_row,
                    "similarity": float(row['similarity']),
                    "z": row['z'],
                    "year": row['data_year'],
                    "month": row['data_month'],
                    "key": f"{row['z']}_{row['x']}_{row['y']}_{patch_col}_{patch_row}_{row['data_year']}"
                })

            return results
        except Exception as e:
            logger.error(f"SQL检索失败: {str(e)}")
            raise

    @staticmethod
    async def search_similar_vectors_multi_years(query_vector: List[float], years: List[int],
                                                 limit_per_year: int, month: Optional[int] = None) -> List[
        Dict[str, Any]]:
        all_results = []
        for year in years:
            try:
                year_results = await DatabaseManager.search_similar_vectors(
                    query_vector, limit_per_year, year, month
                )
                all_results.extend(year_results)
            except Exception as e:
                logger.error(f"年份 {year} 搜索失败: {str(e)}")
                continue

        all_results.sort(key=lambda x: x["similarity"], reverse=True)
        return all_results


# ==================== 坐标转换工具 ====================
class CoordinateConverter:
    @staticmethod
    def latlng_to_pixel(lat: float, lng: float, zoom: int) -> Tuple[float, float]:
        lat_rad = math.radians(lat)
        n = 2.0 ** zoom
        x = (lng + 180.0) / 360.0 * n * 256
        y = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n * 256
        return x, y

    @staticmethod
    def pixel_to_tile(x: float, y: float) -> Tuple[int, int]:
        return int(x // 256), int(y // 256)

    @staticmethod
    def latlng_to_tile(lat: float, lng: float, zoom: int) -> Tuple[int, int]:
        x, y = CoordinateConverter.latlng_to_pixel(lat, lng, zoom)
        return CoordinateConverter.pixel_to_tile(x, y)

    @staticmethod
    def tile_to_latlng_bounds(col: int, row: int, zoom: int) -> Tuple[float, float, float, float]:
        n = 2.0 ** zoom
        left = (col / n) * 360.0 - 180.0
        top = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / n))))
        right = ((col + 1) / n) * 360.0 - 180.0
        bottom = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (row + 1) / n))))
        return bottom, left, top, right

    @staticmethod
    def get_patch_pixel_bounds(patch_col: int, patch_row: int) -> Tuple[int, int, int, int]:
        cfg = CURRENT_CONFIG
        feat_x_start = patch_col * cfg['stride']
        feat_y_start = patch_row * cfg['stride']
        feat_x_end = feat_x_start + cfg['win']
        feat_y_end = feat_y_start + cfg['win']

        x_min = int(feat_x_start * PIXELS_PER_GRID)
        y_min = int(feat_y_start * PIXELS_PER_GRID)
        x_max = int(feat_x_end * PIXELS_PER_GRID)
        y_max = int(feat_y_end * PIXELS_PER_GRID)

        x_max = min(x_max, TILE_PIXEL_SIZE)
        y_max = min(y_max, TILE_PIXEL_SIZE)

        return x_min, y_min, x_max, y_max

    @staticmethod
    def patch_to_latlng_bounds(col: int, row: int, patch_col: int, patch_row: int, zoom: int) -> List[List[float]]:
        bottom, left, top, right = CoordinateConverter.tile_to_latlng_bounds(col, row, zoom)
        tile_lat_height = top - bottom
        tile_lng_width = right - left

        px_min, py_min, px_max, py_max = CoordinateConverter.get_patch_pixel_bounds(patch_col, patch_row)

        r_left = px_min / TILE_PIXEL_SIZE
        r_right = px_max / TILE_PIXEL_SIZE
        r_top = py_min / TILE_PIXEL_SIZE
        r_bottom = py_max / TILE_PIXEL_SIZE

        p_left = left + r_left * tile_lng_width
        p_right = left + r_right * tile_lng_width
        p_top = top - r_top * tile_lat_height
        p_bottom = top - r_bottom * tile_lat_height

        return [
            [p_bottom, p_left],
            [p_bottom, p_right],
            [p_top, p_right],
            [p_top, p_left]
        ]

    @staticmethod
    def pixel_to_latlng(x: float, y: float, zoom: int) -> Tuple[float, float]:
        n = 2.0 ** zoom
        lng = x / (256 * n) * 360.0 - 180.0
        lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / (256 * n))))
        lat = math.degrees(lat_rad)
        return lat, lng


# ==================== 并查集工具 ====================
class UnionFind:
    def __init__(self, n: int):
        self.p = list(range(n))
        self.r = [0] * n

    def find(self, x: int) -> int:
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: int, b: int):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.r[ra] < self.r[rb]:
            self.p[ra] = rb
        elif self.r[ra] > self.r[rb]:
            self.p[rb] = ra
        else:
            self.p[rb] = ra
            self.r[ra] += 1


# ==================== 目标聚合工具 ====================
class TargetAggregator:
    @staticmethod
    def calculate_patch_center(col: int, row: int, patch_col: int, patch_row: int, zoom: int = 18) -> Tuple[
        float, float]:
        px_min, py_min, px_max, py_max = CoordinateConverter.get_patch_pixel_bounds(patch_col, patch_row)
        rel_center_x = (px_min + px_max) / 2
        rel_center_y = (py_min + py_max) / 2
        abs_center_x = col * TILE_PIXEL_SIZE + rel_center_x
        abs_center_y = row * TILE_PIXEL_SIZE + rel_center_y
        return abs_center_x, abs_center_y

    @staticmethod
    def calculate_aggregate_bounds(aggregate: List[Dict[str, Any]], zoom: int = 18) -> List[List[float]]:
        if not aggregate:
            return []
        all_points = []
        for patch in aggregate:
            bounds = CoordinateConverter.patch_to_latlng_bounds(
                patch["col"], patch["row"],
                patch["patch_col"], patch["patch_row"],
                zoom
            )
            all_points.extend(bounds)

        lats = [p[0] for p in all_points]
        lngs = [p[1] for p in all_points]
        return [[min(lats), min(lngs)], [min(lats), max(lngs)], [max(lats), max(lngs)], [max(lats), min(lngs)]]

    @staticmethod
    def calculate_aggregate_center(aggregate: List[Dict[str, Any]], zoom: int = 18) -> Tuple[float, float]:
        bounds = TargetAggregator.calculate_aggregate_bounds(aggregate, zoom)
        if not bounds:
            return None
        lats = [p[0] for p in bounds]
        lngs = [p[1] for p in bounds]
        return (min(lats) + max(lats)) / 2, (min(lngs) + max(lngs)) / 2

    @staticmethod
    def calculate_aggregate_info(aggregate: List[Dict[str, Any]], zoom: int = 18) -> Dict[str, Any]:
        if not aggregate:
            return {}
        bounds = TargetAggregator.calculate_aggregate_bounds(aggregate, zoom)
        center = TargetAggregator.calculate_aggregate_center(aggregate, zoom)
        max_similarity = max(patch["similarity"] for patch in aggregate)
        avg_similarity = sum(patch["similarity"] for patch in aggregate) / len(aggregate)
        return {
            "bounds": bounds,
            "center": list(center) if center else None,
            "patch_count": len(aggregate),
            "max_similarity": max_similarity,
            "avg_similarity": avg_similarity,
            "similarity": avg_similarity
        }

    @staticmethod
    def patch_to_global_pixel_bounds(patch: Dict[str, Any]) -> Tuple[float, float, float, float]:
        col, row = patch["col"], patch["row"]
        pc, pr = patch["patch_col"], patch["patch_row"]
        px_min, py_min, px_max, py_max = CoordinateConverter.get_patch_pixel_bounds(pc, pr)
        x0 = col * TILE_PIXEL_SIZE + px_min
        y0 = row * TILE_PIXEL_SIZE + py_min
        x1 = col * TILE_PIXEL_SIZE + px_max
        y1 = row * TILE_PIXEL_SIZE + py_max
        return float(x0), float(y0), float(x1), float(y1)

    @staticmethod
    def aggregate_by_touch(patches: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
        if not patches:
            return []

        rects = []
        for p in patches:
            x0, y0, x1, y1 = TargetAggregator.patch_to_global_pixel_bounds(p)
            rects.append(box(x0, y0, x1, y1))

        n = len(patches)
        uf = UnionFind(n)

        for i in range(n):
            for j in range(i + 1, n):
                if rects[i].intersects(rects[j]):
                    uf.union(i, j)

        groups: Dict[int, List[Dict[str, Any]]] = {}
        for i in range(n):
            root = uf.find(i)
            groups.setdefault(root, []).append(patches[i])

        agg = list(groups.values())
        agg.sort(key=len, reverse=True)
        return agg

    @staticmethod
    def union_geometry_geojson(aggregate: List[Dict[str, Any]], zoom: int = 18) -> Dict[str, Any]:
        if not aggregate:
            return {"type": "GeometryCollection", "geometries": []}

        polys = []
        for p in aggregate:
            x0, y0, x1, y1 = TargetAggregator.patch_to_global_pixel_bounds(p)
            polys.append(box(x0, y0, x1, y1))

        geom = unary_union(polys)
        g = mapping(geom)

        def to_lnglat(coords):
            out = []
            for (x, y) in coords:
                lat, lng = CoordinateConverter.pixel_to_latlng(x, y, zoom)
                out.append([lng, lat])
            return out

        if g["type"] == "Polygon":
            rings = []
            for ring in g["coordinates"]:
                rings.append(to_lnglat(ring))
            return {"type": "Polygon", "coordinates": rings}

        if g["type"] == "MultiPolygon":
            mp = []
            for poly in g["coordinates"]:
                rings = []
                for ring in poly:
                    rings.append(to_lnglat(ring))
                mp.append(rings)
            return {"type": "MultiPolygon", "coordinates": mp}

        return {"type": "GeometryCollection", "geometries": []}


# ==================== 缩略图生成工具 ====================
class ThumbnailGenerator:
    def __init__(self, tiles_root: str):
        self.tiles_root = tiles_root

    def get_tile_path(self, year: int, zoom: int, col: int, row: int) -> str:
        path = os.path.join(self.tiles_root, str(year), str(zoom), str(col), f"{row}.png")
        return os.path.normpath(path)

    def load_tile(self, year: int, zoom: int, col: int, row: int) -> Image.Image:
        tile_path = self.get_tile_path(year, zoom, col, row)
        if not os.path.exists(tile_path):
            return self.create_error_tile(col, row, year)
        try:
            img = Image.open(tile_path).convert("RGB")
            return img
        except Exception as e:
            logger.error(f"加载瓦片失败: {tile_path}, 错误: {str(e)}")
            return self.create_error_tile(col, row, year)

    def create_error_tile(self, col: int, row: int, year: int) -> Image.Image:
        tile = Image.new("RGB", (256, 256), (200, 100, 100))
        draw = ImageDraw.Draw(tile)
        try:
            font = ImageFont.load_default()
            draw.text((10, 10), f"Y{year}", fill=(255, 255, 255), font=font)
            draw.text((10, 30), f"{col},{row}", fill=(255, 255, 255), font=font)
        except:
            pass
        draw.line([(0, 0), (255, 255)], fill=(255, 0, 0), width=3)
        draw.line([(0, 255), (255, 0)], fill=(255, 0, 0), width=3)
        return tile

    def generate_patch_thumbnail(self, patch_info: Dict[str, Any], zoom: int = 18) -> str:
        try:
            col, row = patch_info["col"], patch_info["row"]
            patch_col, patch_row = patch_info["patch_col"], patch_info["patch_row"]
            z = patch_info.get("z", zoom)
            year = patch_info.get("year", settings.DEFAULT_YEAR)

            tile_img = self.load_tile(year, z, col, row)
            px_min, py_min, px_max, py_max = CoordinateConverter.get_patch_pixel_bounds(patch_col, patch_row)
            patch_img = tile_img.crop((px_min, py_min, px_max, py_max))

            w, h = patch_img.size
            bordered_img = Image.new("RGB", (w + 4, h + 4), (255, 0, 0))
            bordered_img.paste(patch_img, (2, 2))

            buffer = io.BytesIO()
            bordered_img.save(buffer, format="PNG")
            buffer.seek(0)
            return base64.b64encode(buffer.read()).decode('utf-8')
        except Exception as e:
            logger.error(f"生成缩略图失败: {str(e)}")
            return ""


# ==================== 多边形截图工具 ====================
class PolygonScreenshotGenerator:
    def __init__(self, tiles_root: str):
        self.tiles_root = tiles_root

    def get_tile_path(self, year: int, zoom: int, col: int, row: int) -> str:
        path = os.path.join(self.tiles_root, str(year), str(zoom), str(col), f"{row}.png")
        return os.path.normpath(path)

    def load_tile(self, year: int, zoom: int, col: int, row: int) -> Image.Image:
        tile_path = self.get_tile_path(year, zoom, col, row)
        if not os.path.exists(tile_path):
            return self.create_error_tile(col, row, year)
        try:
            img = Image.open(tile_path).convert("RGB")
            return img
        except Exception:
            return self.create_error_tile(col, row, year)

    def create_error_tile(self, col: int, row: int, year: int) -> Image.Image:
        tile = self.create_blank_tile((200, 100, 100))
        draw = ImageDraw.Draw(tile)
        try:
            font = ImageFont.load_default()
            draw.text((10, 10), f"Y{year}", fill=(255, 255, 255), font=font)
        except:
            pass
        draw.line([(0, 0), (255, 255)], fill=(255, 0, 0), width=3)
        draw.line([(0, 255), (255, 0)], fill=(255, 0, 0), width=3)
        return tile

    def create_blank_tile(self, color: Tuple[int, int, int] = (100, 100, 100)) -> Image.Image:
        return Image.new("RGB", (256, 256), color)

    def calculate_polygon_bounds(self, polygon: List[List[float]], zoom: int) -> Dict[str, Any]:
        pixel_points = []
        for lat, lng in polygon:
            x, y = CoordinateConverter.latlng_to_pixel(lat, lng, zoom)
            pixel_points.append((x, y))

        min_x = min(p[0] for p in pixel_points)
        max_x = max(p[0] for p in pixel_points)
        min_y = min(p[1] for p in pixel_points)
        max_y = max(p[1] for p in pixel_points)

        width = max_x - min_x
        height = max_y - min_y
        size = max(width, height)

        center_x = (min_x + max_x) / 2
        center_y = (min_y + max_y) / 2

        square_min_x = max(0, center_x - size / 2)
        square_min_y = max(0, center_y - size / 2)

        tile_min_col, tile_min_row = CoordinateConverter.pixel_to_tile(square_min_x, square_min_y)
        tile_max_col, tile_max_row = CoordinateConverter.pixel_to_tile(square_min_x + size, square_min_y + size)

        needed_tiles = []
        for col in range(tile_min_col, tile_max_col + 1):
            for row in range(tile_min_row, tile_max_row + 1):
                needed_tiles.append({
                    "col": col,
                    "row": row,
                    "pixel_x": col * 256,
                    "pixel_y": row * 256
                })

        return {
            "square_bounds": {
                "min_x": square_min_x,
                "max_x": square_min_x + size,
                "min_y": square_min_y,
                "max_y": square_min_y + size,
                "size": size,
                "center_x": center_x,
                "center_y": center_y
            },
            "needed_tiles": needed_tiles,
            "pixel_points": pixel_points,
            "tile_bounds": {
                "min_col": tile_min_col,
                "max_col": tile_max_col,
                "min_row": tile_min_row,
                "max_row": tile_max_row
            }
        }

    def calculate_center_crop_area(self, mosaic_width: int, mosaic_height: int,
                                   center_x: float, center_y: float,
                                   output_size: int = 256) -> Tuple[float, float, float, float]:
        half_size = output_size / 2
        crop_x1 = center_x - half_size
        crop_y1 = center_y - half_size
        crop_x2 = center_x + half_size
        crop_y2 = center_y + half_size

        if crop_x1 < 0:
            crop_x2 -= crop_x1
            crop_x1 = 0
        elif crop_x2 > mosaic_width:
            crop_x1 -= (crop_x2 - mosaic_width)
            crop_x2 = mosaic_width

        if crop_y1 < 0:
            crop_y2 -= crop_y1
            crop_y1 = 0
        elif crop_y2 > mosaic_height:
            crop_y1 -= (crop_y2 - mosaic_height)
            crop_y2 = mosaic_height

        return crop_x1, crop_y1, crop_x2, crop_y2

    def generate_screenshot_and_mask(self, polygon: List[List[float]], zoom: int = 18,
                                     output_size: int = 256, year: Optional[int] = None):
        if year is None:
            year = settings.DEFAULT_YEAR

        bounds_info = self.calculate_polygon_bounds(polygon, zoom)
        square_bounds = bounds_info["square_bounds"]
        needed_tiles = bounds_info["needed_tiles"]
        pixel_points = bounds_info["pixel_points"]

        tile_cols = bounds_info["tile_bounds"]["max_col"] - bounds_info["tile_bounds"]["min_col"] + 1
        tile_rows = bounds_info["tile_bounds"]["max_row"] - bounds_info["tile_bounds"]["min_row"] + 1

        mosaic_width = tile_cols * 256
        mosaic_height = tile_rows * 256
        mosaic_image = Image.new("RGB", (mosaic_width, mosaic_height))
        mosaic_mask = Image.new("L", (mosaic_width, mosaic_height), 0)

        for tile_info in needed_tiles:
            col, row = tile_info["col"], tile_info["row"]
            tile_img = self.load_tile(year, zoom, col, row)

            mosaic_x = (col - bounds_info["tile_bounds"]["min_col"]) * 256
            mosaic_y = (row - bounds_info["tile_bounds"]["min_row"]) * 256
            mosaic_image.paste(tile_img, (mosaic_x, mosaic_y))

        relative_points = []
        base_col = bounds_info["tile_bounds"]["min_col"]
        base_row = bounds_info["tile_bounds"]["min_row"]
        for x, y in pixel_points:
            relative_points.append((x - base_col * 256, y - base_row * 256))

        if len(relative_points) >= 3:
            draw = ImageDraw.Draw(mosaic_mask)
            draw.polygon(relative_points, fill=255)

        square_center_rel_x = square_bounds["center_x"] - base_col * 256
        square_center_rel_y = square_bounds["center_y"] - base_row * 256
        square_size = square_bounds["size"]

        transform_info = {}

        if square_size <= output_size:
            crop_x1, crop_y1, crop_x2, crop_y2 = self.calculate_center_crop_area(
                mosaic_width, mosaic_height, square_center_rel_x, square_center_rel_y, output_size
            )
            crop_coords = (int(crop_x1), int(crop_y1), int(crop_x2), int(crop_y2))

            final_image = mosaic_image.crop(crop_coords)
            final_mask = mosaic_mask.crop(crop_coords)

            if final_image.size != (output_size, output_size):
                final_image = final_image.resize((output_size, output_size), Image.Resampling.LANCZOS)
                final_mask = final_mask.resize((output_size, output_size), Image.Resampling.NEAREST)

            transform_info["type"] = "center_crop"
        else:
            crop_x1 = int(square_bounds["min_x"] - base_col * 256)
            crop_y1 = int(square_bounds["min_y"] - base_row * 256)
            crop_x2 = int(square_bounds["max_x"] - base_col * 256)
            crop_y2 = int(square_bounds["max_y"] - base_row * 256)

            crop_x1 = max(0, min(crop_x1, mosaic_width))
            crop_y1 = max(0, min(crop_y1, mosaic_height))
            crop_x2 = max(0, min(crop_x2, mosaic_width))
            crop_y2 = max(0, min(crop_y2, mosaic_height))

            cropped_image = mosaic_image.crop((crop_x1, crop_y1, crop_x2, crop_y2))
            cropped_mask = mosaic_mask.crop((crop_x1, crop_y1, crop_x2, crop_y2))

            final_image = cropped_image.resize((output_size, output_size), Image.Resampling.LANCZOS)
            final_mask = cropped_mask.resize((output_size, output_size), Image.Resampling.NEAREST)

            transform_info["type"] = "scale_crop"

        return final_image, final_mask, transform_info

    def image_to_base64(self, image: Image.Image) -> str:
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        buffer.seek(0)
        return base64.b64encode(buffer.read()).decode('utf-8')


# ==================== DINOv3特征提取工具 ====================
class DINOv3FeatureExtractor:
    def __init__(self, model_path: str, device: str = "cuda:0"):
        self.device = device
        self.processor = AutoImageProcessor.from_pretrained(model_path)
        self.model = AutoModel.from_pretrained(
            model_path,
            use_safetensors=True,
            device_map='auto' if device == "cuda:0" else None
        )
        if device != "cuda:0" and not device.startswith("cuda"):
            self.model = self.model.to(device)
        self.model.eval()
        self.num_regs = getattr(self.model.config, 'num_register_tokens', 0)

    def extract_features(self, image: Image.Image, mask: Optional[Image.Image] = None) -> np.ndarray:
        inputs = self.processor(images=image, return_tensors="pt").to(self.model.device)
        with torch.no_grad():
            outputs = self.model(**inputs)

        patch_features = outputs.last_hidden_state[0, 1 + self.num_regs:, :]

        if mask is None:
            max_pool, _ = torch.max(patch_features, dim=0)
            return normalize_features(max_pool.cpu().numpy())
        else:
            mask_resized = mask.resize((14, 14), Image.Resampling.NEAREST)
            mask_array = np.array(mask_resized) > 0
            if not np.any(mask_array):
                max_pool, _ = torch.max(patch_features, dim=0)
                return normalize_features(max_pool.cpu().numpy())

            mask_flat = torch.from_numpy(mask_array.flatten()).bool().to(patch_features.device)
            region_features = patch_features[mask_flat]

            if region_features.shape[0] == 0:
                max_pool, _ = torch.max(patch_features, dim=0)
                return normalize_features(max_pool.cpu().numpy())

            max_pool, _ = torch.max(region_features, dim=0)
            return normalize_features(max_pool.cpu().numpy())


# ==================== 生命周期管理 ====================
screenshot_generator = None
feature_extractor = None
thumbnail_generator = None
sample_manager = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global feature_extractor, screenshot_generator, thumbnail_generator, sample_manager

    logger.info("===== 启动后端服务 =====")
    logger.info(f"设备: {settings.DEVICE}")
    logger.info(f"当前配置模式: {settings.ACTIVE_TABLE}")
    logger.info(f"瓦片根目录: {settings.TILES_ROOT}")

    await DatabaseManager.init_pool()

    try:
        feature_extractor = DINOv3FeatureExtractor(settings.MODEL_CKPT_PATH, settings.DEVICE)
        logger.info("DINOv3模型加载成功")
    except Exception as e:
        logger.error(f"模型加载失败: {str(e)}")

    screenshot_generator = PolygonScreenshotGenerator(settings.TILES_ROOT)
    thumbnail_generator = ThumbnailGenerator(settings.TILES_ROOT)
    sample_manager = SampleManager(settings.SAMPLES_ROOT, settings.MASKS_ROOT)

    # 检查瓦片目录结构
    available_years = []
    if os.path.exists(settings.TILES_ROOT):
        for item in os.listdir(settings.TILES_ROOT):
            if os.path.isdir(os.path.join(settings.TILES_ROOT, item)) and item.isdigit():
                available_years.append(int(item))

    logger.info(f"发现可用年份瓦片: {sorted(available_years)}")

    yield

    logger.info("===== 关闭服务 =====")
    await DatabaseManager.close_pool()
    if settings.DEVICE == "cuda":
        torch.cuda.empty_cache()


def _parse_tianditu_geocode_result(data: dict):
    if not isinstance(data, dict):
        return None
    if str(data.get("status")) != "0":
        return None

    loc = data.get("location")
    if isinstance(loc, dict):
        lat = loc.get("lat")
        lon = loc.get("lon") or loc.get("lng")
        if lat is not None and lon is not None:
            return float(lat), float(lon)

    return None


app = FastAPI(title="全域AI图侦系统后端（多年份版）", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# 挂载静态文件
app.mount("/tiles", StaticFiles(directory=settings.TILES_ROOT), name="tiles")
app.mount("/examples", StaticFiles(directory=settings.SAMPLES_ROOT), name="examples")
app.mount("/masks", StaticFiles(directory=settings.MASKS_ROOT), name="masks")


# ==================== API接口 ====================
@app.get("/health")
async def health_check():
    count = await DatabaseManager.get_feature_count()
    available_years = await DatabaseManager.get_available_years()
    return {
        "status": "success",
        "service": f"全域AI图侦系统后端 ({settings.ACTIVE_TABLE})",
        "device": settings.DEVICE,
        "db_connected": db_pool is not None,
        "model_loaded": feature_extractor is not None,
        "feature_count": count,
        "available_years": available_years,
        "default_year": settings.DEFAULT_YEAR,
        "tiles_root": settings.TILES_ROOT,
        "samples_count": len(sample_manager.get_all_samples())
    }


@app.get("/available_years")
async def get_available_years():
    """获取可用的年份列表"""
    try:
        db_years = await DatabaseManager.get_available_years()

        fs_years = []
        if os.path.exists(settings.TILES_ROOT):
            for item in os.listdir(settings.TILES_ROOT):
                item_path = os.path.join(settings.TILES_ROOT, item)
                if os.path.isdir(item_path) and item.isdigit():
                    zoom_path = os.path.join(item_path, str(settings.DEFAULT_ZOOM))
                    if os.path.exists(zoom_path):
                        fs_years.append(int(item))

        return {
            "status": "success",
            "database_years": sorted(db_years),
            "filesystem_years": sorted(fs_years),
            "intersection": sorted(list(set(db_years) & set(fs_years)))
        }
    except Exception as e:
        logger.error(f"获取可用年份失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/geocode")
async def geocode(req: GeocodeRequest):
    q = (req.q or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="q 不能为空")

    if not settings.TDT_SERVER_TK:
        raise HTTPException(status_code=500, detail="后端未配置 TDT_SERVER_TK，无法进行地名检索")

    url = "https://api.tianditu.gov.cn/geocoder"
    params = {
        "ds": json.dumps({"keyWord": q}, ensure_ascii=False),
        "tk": settings.TDT_SERVER_TK
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url, params=params)

            if r.status_code != 200:
                body = r.text
                logger.error(f"TDT geocoder failed: status={r.status_code}, url={str(r.url)}, body={body}")
                short_body = body[:1500]
                raise HTTPException(
                    status_code=502,
                    detail=f"天地图 geocoder HTTP {r.status_code}: {short_body}"
                )

            data = r.json()
            logger.info(f"TDT geocoder OK: q={q}")

        latlon = _parse_tianditu_geocode_result(data)
        if not latlon:
            return {
                "status": "not_found",
                "q": q,
                "provider": "tianditu",
                "raw": data
            }

        lat, lon = latlon
        return {
            "status": "success",
            "q": q,
            "lat": float(lat),
            "lng": float(lon),
            "provider": "tianditu",
            "raw": data
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"/geocode 失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate_screenshot")
async def generate_screenshot(request: PolygonRequest):
    """生成截图（支持指定年份）"""
    try:
        if screenshot_generator is None:
            raise HTTPException(status_code=500, detail="截图生成器未初始化")

        year = request.year or settings.DEFAULT_YEAR

        image, mask, transform_info = screenshot_generator.generate_screenshot_and_mask(
            polygon=request.polygon,
            zoom=request.zoom,
            output_size=request.output_size,
            year=year
        )

        image_base64 = screenshot_generator.image_to_base64(image)
        mask_base64 = screenshot_generator.image_to_base64(mask)

        features_list = None
        if feature_extractor is not None:
            features_np = feature_extractor.extract_features(image, mask)
            features_list = features_np.tolist()

        return {
            "status": "success",
            "image_base64": image_base64,
            "mask_base64": mask_base64,
            "image_size": list(image.size),
            "mask_size": list(mask.size),
            "features": features_list,
            "transform_info": transform_info,
            "year": year,
            "message": f"截图生成成功（{year}年）"
        }
    except Exception as e:
        logger.error(f"截图生成失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract_features")
async def extract_features(req: ExtractFeaturesRequest):
    """提取特征"""
    try:
        if feature_extractor is None:
            raise HTTPException(status_code=500, detail="特征提取器未初始化")

        img = base64_to_pil_image(req.image_base64, mode="RGB")
        ensure_256x256(img, "image")

        mask = None
        if req.mask_base64:
            mask = base64_to_pil_image(req.mask_base64, mode="L")
            ensure_256x256(mask, "mask")

        features_np = feature_extractor.extract_features(img, mask)

        if features_np is None or len(features_np) != FEATURE_DIM:
            raise HTTPException(status_code=500, detail=f"特征维度异常")

        return {
            "status": "success",
            "features": features_np.tolist(),
            "image_size": list(img.size),
            "mask_size": list(mask.size) if mask is not None else None,
            "year": req.year,
            "message": "特征提取成功"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"/extract_features 失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search_similar")

async def search_similar(request_data: Dict[str, Any] = Body(...)):
    """搜索相似图斑"""
    try:
        features = request_data.get("features")
        year = request_data.get("year")
        month = request_data.get("month")

        if not features or len(features) != FEATURE_DIM:
            raise HTTPException(status_code=400, detail="特征无效")

        results = await DatabaseManager.search_similar_vectors(features, limit=100, year=year, month=month)

        if not results:
            raise HTTPException(status_code=404, detail=f"未找到匹配图斑")

        return {
            "status": "success",
            "top10": results[:20],
            "total_matched": len(results),
            "year": year,
            "month": month,
            "message": f"找到 {len(results)} 个匹配图斑"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"搜索失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search_by_year")
async def search_by_year(request: YearSearchRequest):
    """按年份搜索"""
    try:
        if len(request.features) != FEATURE_DIM:
            raise HTTPException(status_code=400, detail="特征维度错误")

        results = await DatabaseManager.search_similar_vectors(
            request.features,
            limit=request.top_n,
            year=request.year,
            month=request.month
        )

        if not results:
            return {
                "status": "success",
                "results": [],
                "year": request.year,
                "month": request.month,
                "message": f"未在{request.year}年找到匹配图斑"
            }

        return {
            "status": "success",
            "results": results,
            "year": request.year,
            "month": request.month,
            "total_matched": len(results),
            "message": f"在{request.year}年找到 {len(results)} 个匹配图斑"
        }
    except Exception as e:
        logger.error(f"按年份搜索失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search_top_n_target")
async def search_top_n_target(request: SearchRequest):
    """目标聚合搜索"""
    try:
        if len(request.features) != FEATURE_DIM:
            raise HTTPException(status_code=400, detail="特征维度错误")

        top_n = max(50, min(500, request.top_n))
        year = request.year

        top_n_results = await DatabaseManager.search_similar_vectors(
            request.features,
            limit=top_n,
            year=year
        )

        if not top_n_results:
            return {
                "status": "success",
                "targets": [],
                "year": year,
                "message": f"未在{year}年找到图斑"
            }

        aggregates = TargetAggregator.aggregate_by_touch(top_n_results)

        target_results = []
        for i, aggregate_patches in enumerate(aggregates):
            aggregate_info = TargetAggregator.calculate_aggregate_info(aggregate_patches, zoom=18)
            geo = TargetAggregator.union_geometry_geojson(aggregate_patches, zoom=18)

            thumbnail = None
            if thumbnail_generator and aggregate_patches:
                best_patch = max(aggregate_patches, key=lambda x: x["similarity"])
                thumbnail = thumbnail_generator.generate_patch_thumbnail(best_patch, zoom=18)

            target_results.append({
                "target_id": i + 1,
                "geometry": geo,
                "bounds": aggregate_info["bounds"],
                "center": aggregate_info["center"],
                "patch_count": aggregate_info["patch_count"],
                "max_similarity": aggregate_info["max_similarity"],
                "avg_similarity": aggregate_info["avg_similarity"],
                "similarity": aggregate_info["similarity"],
                "thumbnail": thumbnail,
                "patches": aggregate_patches,
                "year": year
            })

        target_results.sort(key=lambda x: x["similarity"], reverse=True)

        return {
            "status": "success",
            "top_n": top_n,
            "targets": target_results,
            "filtered_results": top_n_results,
            "total_targets": len(aggregates),
            "year": year,
            "message": f"聚合完成: 在{year}年找到{len(aggregates)}个目标"
        }
    except Exception as e:
        logger.error(f"目标聚合搜索失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


class ChangeDetectionBySamplesResponse(BaseModel):
    status: str
    targets: List[Dict[str, Any]]
    message: str
    total_patches: int = 0
    total_targets: int = 0


# 新增辅助函数：获取样本特征
async def get_sample_features(sample_id: str, tag: str = None) -> Optional[np.ndarray]:
    """获取样本特征向量"""
    try:
        # 1. 首先尝试从样本管理器获取
        sample_info = sample_manager.get_sample(sample_id)
        if sample_info and sample_info.get("features"):
            return np.array(sample_info["features"])

        # 2. 如果不存在，从文件系统读取并提取特征
        # 查找样本文件
        samples_root = Path(settings.SAMPLES_ROOT)
        masks_root = Path(settings.MASKS_ROOT)

        # 查找所有标签目录
        for tag_dir in samples_root.iterdir():
            if tag_dir.is_dir():
                # 查找样本JSON文件
                json_file = tag_dir / f"{sample_id}.json"
                if json_file.exists():
                    with open(json_file, 'r', encoding='utf-8') as f:
                        sample_data = json.load(f)

                    # 获取图片和掩码路径
                    image_path = samples_root / sample_data["image_path"]
                    mask_path = None
                    if sample_data.get("mask_path"):
                        mask_path = masks_root / sample_data["mask_path"]


                    # 读取图片
                    if image_path.exists():
                        img = Image.open(image_path).convert("RGB")
                        mask = None
                        if mask_path and mask_path.exists():
                            mask = Image.open(mask_path).convert("L")

                        # 提取特征
                        features_np = feature_extractor.extract_features(img, mask)

                        # 更新样本信息
                        sample_data["features"] = features_np.tolist()
                        with open(json_file, 'w', encoding='utf-8') as f:
                            json.dump(sample_data, f, ensure_ascii=False, indent=2)

                        return features_np

        return None
    except Exception as e:
        logger.error(f"获取样本特征失败 {sample_id}: {str(e)}")
        return None

@app.post("/change_detection_by_samples")
async def change_detection_by_samples(request: ChangeDetectionBySamplesRequest):
    """基于样本特征差的跨时相变化检测"""
    try:
        logger.info(f"特征差变化检测: 样本1={request.sample_id1}, 年份1={request.year1}, "
                    f"样本2={request.sample_id2}, 年份2={request.year2}")

        if feature_extractor is None:
            raise HTTPException(status_code=500, detail="特征提取器未初始化")

        # 1. 获取前后时相样本特征
        features1 = await get_sample_features(request.sample_id1)
        features2 = await get_sample_features(request.sample_id2)

        if features1 is None or features2 is None:
            raise HTTPException(status_code=404, detail="样本特征获取失败")

        # 2. 计算样本特征差（前时相 - 后时相）
        features1_np = np.array(features1)
        features2_np = np.array(features2)

        # 确保特征向量是归一化的
        features1_np = normalize_features(features1_np)
        features2_np = normalize_features(features2_np)

        # 计算特征差
        sample_diff = features1_np - features2_np

        # 归一化特征差（可选，根据实际效果决定,当前未归一化）
        # sample_diff_norm = normalize_features(sample_diff)
        sample_diff_norm=sample_diff

        logger.info(f"计算样本特征差: 维度={sample_diff_norm.shape}, 范数={np.linalg.norm(sample_diff_norm)}")

        # 3. 在特征差表中检索相似变化
        results = await DatabaseManager.search_similar_by_diff(
            query_diff_vector=sample_diff_norm.tolist(),
            limit=request.top_n,
            year_before=request.year1,
            year_after=request.year2
        )

        if not results:
            return {
                "status": "success",
                "targets": [],
                "message": f"未在{request.year1}年→{request.year2}年找到相似的变化图斑",
                "total_patches": 0,
                "total_targets": 0
            }

        logger.info(f"特征差检索到 {len(results)} 个候选图斑")

        # 4. 应用最小相似度阈值
        filtered_patches = [p for p in results if p["similarity"] >= request.min_similarity]

        if not filtered_patches:
            return {
                "status": "success",
                "targets": [],
                "message": f"未找到满足最小相似度阈值({request.min_similarity})的变化图斑",
                "total_patches": len(results),
                "total_targets": 0
            }

        logger.info(f"阈值过滤后剩余 {len(filtered_patches)} 个图斑")

        # 5. 空间聚类聚合
        logger.info(f"空间聚类聚合 {len(filtered_patches)} 个图斑...")
        aggregates = TargetAggregator.aggregate_by_touch(filtered_patches)

        logger.info(f"聚合为 {len(aggregates)} 个目标")

        # 6. 构建返回结果
        target_results = []
        for i, aggregate_patches in enumerate(aggregates):
            if not aggregate_patches:
                continue

            # 计算聚合信息
            aggregate_info = TargetAggregator.calculate_aggregate_info(aggregate_patches, zoom=18)
            geo = TargetAggregator.union_geometry_geojson(aggregate_patches, zoom=18)

            # 计算统计信息
            patch_count = len(aggregate_patches)
            avg_similarity = sum(p["similarity"] for p in aggregate_patches) / patch_count
            max_similarity = max(p["similarity"] for p in aggregate_patches)

            # 为了兼容前端，我们计算"变化分数"（基于相似度）
            # 相似度越高，说明与样本的变化模式越相似
            change_score = avg_similarity

            # 生成缩略图（使用前时相年份的瓦片）
            thumbnail = None
            if thumbnail_generator and aggregate_patches:
                best_patch = max(aggregate_patches, key=lambda x: x.get("similarity", 0))

                # 修改缩略图生成，使用前时相年份
                try:
                    col, row = best_patch["col"], best_patch["row"]
                    patch_col, patch_row = best_patch["patch_col"], best_patch["patch_row"]
                    z = best_patch.get("z", 18)

                    # 加载前时相瓦片
                    tile_img = thumbnail_generator.load_tile(request.year1, z, col, row)

                    # 裁剪patch区域
                    px_min, py_min, px_max, py_max = CoordinateConverter.get_patch_pixel_bounds(patch_col, patch_row)
                    patch_img = tile_img.crop((px_min, py_min, px_max, py_max))

                    # 添加边框
                    w, h = patch_img.size
                    bordered_img = Image.new("RGB", (w + 4, h + 4), (255, 0, 0))
                    bordered_img.paste(patch_img, (2, 2))

                    buffer = io.BytesIO()
                    bordered_img.save(buffer, format="PNG")
                    buffer.seek(0)
                    thumbnail = base64.b64encode(buffer.read()).decode('utf-8')
                except Exception as e:
                    logger.error(f"生成缩略图失败: {str(e)}")

            target_results.append({
                "target_id": i + 1,
                "geometry": geo,
                "bounds": aggregate_info["bounds"],
                "center": aggregate_info["center"],
                "patch_count": patch_count,
                "max_similarity": max_similarity,
                "avg_similarity": avg_similarity,
                "change_score": change_score,
                "similarity": avg_similarity,  # 兼容性字段
                "thumbnail": thumbnail,
                "patches": aggregate_patches,
                "year_before": request.year1,
                "year_after": request.year2
            })

        # 按相似度排序
        target_results.sort(key=lambda x: x["change_score"], reverse=True)

        return {
            "status": "success",
            "total_patches": len(filtered_patches),
            "total_targets": len(aggregates),
            "targets": target_results,
            "message": f"特征差变化检测完成: {request.year1}年 → {request.year2}年，找到 {len(target_results)} 个变化目标",
            "debug_info": {
                "sample_diff_norm": float(np.linalg.norm(sample_diff_norm)),
                "retrieved_count": len(results),
                "filtered_count": len(filtered_patches),
                "aggregates_count": len(aggregates),
                "min_similarity": request.min_similarity
            }
        }

    except Exception as e:
        logger.error(f"特征差变化检测失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# 新增获取样本标签的接口
@app.get("/samples/{sample_id}/tag")
async def get_sample_tag(sample_id: str):
    """获取样本的标签"""
    try:
        # 查找样本信息文件
        for root, dirs, files in os.walk(settings.SAMPLES_ROOT):
            for file in files:
                if file == f"{sample_id}.json":
                    info_path = os.path.join(root, file)
                    with open(info_path, 'r', encoding='utf-8') as f:
                        sample_info = json.load(f)

                    return {
                        "status": "success",
                        "sample_id": sample_id,
                        "tag": sample_info.get("tag", "")
                    }

        raise HTTPException(status_code=404, detail="样本不存在")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取样本标签失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 标签管理接口 ====================
@app.get("/tags")
async def get_tags():
    """获取所有标签（samples和masks下的子文件夹名称）"""
    try:
        tags = []

        # 检查samples目录下的子文件夹
        if os.path.exists(settings.SAMPLES_ROOT):
            for item in os.listdir(settings.SAMPLES_ROOT):
                item_path = os.path.join(settings.SAMPLES_ROOT, item)
                if os.path.isdir(item_path):
                    tags.append(item)

        # 确保masks目录下也有相同的标签
        if os.path.exists(settings.MASKS_ROOT):
            for tag in tags:
                tag_path = os.path.join(settings.MASKS_ROOT, tag)
                if not os.path.exists(tag_path):
                    os.makedirs(tag_path, exist_ok=True)

        return {
            "status": "success",
            "tags": sorted(list(set(tags))),
            "count": len(tags)
        }
    except Exception as e:
        logger.error(f"获取标签失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tags")
async def create_tag(request: TagRequest):
    """创建新标签（在samples和masks下创建子文件夹）"""
    try:
        tag_name = request.name.strip()
        if not tag_name:
            raise HTTPException(status_code=400, detail="标签名称不能为空")

        # 创建标签目录
        samples_tag_path = os.path.join(settings.SAMPLES_ROOT, tag_name)
        masks_tag_path = os.path.join(settings.MASKS_ROOT, tag_name)

        os.makedirs(samples_tag_path, exist_ok=True)
        os.makedirs(masks_tag_path, exist_ok=True)

        # 创建标签信息文件
        tag_info = {
            "name": tag_name,
            "created_at": datetime.now().isoformat(),
            "samples_count": 0
        }

        tag_info_path = os.path.join(samples_tag_path, ".tag_info.json")
        with open(tag_info_path, 'w', encoding='utf-8') as f:
            json.dump(tag_info, f, ensure_ascii=False, indent=2)

        logger.info(f"创建标签成功: {tag_name}")
        return {
            "status": "success",
            "tag": tag_name,
            "message": "标签创建成功"
        }
    except Exception as e:
        logger.error(f"创建标签失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/tags/{tag_name}")
async def delete_tag(tag_name: str):
    """删除标签（删除samples和masks下的子文件夹）"""
    try:
        samples_tag_path = os.path.join(settings.SAMPLES_ROOT, tag_name)
        masks_tag_path = os.path.join(settings.MASKS_ROOT, tag_name)

        # 检查是否存在
        if not os.path.exists(samples_tag_path):
            raise HTTPException(status_code=404, detail="标签不存在")

        # 检查是否为空
        def count_files(directory):
            count = 0
            for root, dirs, files in os.walk(directory):
                count += len(files)
            return count

        samples_count = count_files(samples_tag_path)
        masks_count = count_files(masks_tag_path)

        # 减去tag_info文件
        tag_info_file = os.path.join(samples_tag_path, ".tag_info.json")
        if os.path.exists(tag_info_file):
            samples_count -= 1

        if samples_count > 0 or masks_count > 0:
            raise HTTPException(status_code=400, detail="标签下还有文件，无法删除")

        # 删除目录
        import shutil
        shutil.rmtree(samples_tag_path, ignore_errors=True)
        shutil.rmtree(masks_tag_path, ignore_errors=True)

        logger.info(f"删除标签成功: {tag_name}")
        return {
            "status": "success",
            "message": "标签删除成功"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除标签失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 示例图片上传接口（带ROI） ====================
@app.post("/samples/upload")
async def upload_sample_with_roi(request: UploadSampleRequest):
    """上传示例图片并保存ROI掩码（适配前端）"""
    try:
        # 验证标签是否存在或创建
        samples_tag_path = Path(settings.SAMPLES_ROOT) / request.tag
        masks_tag_path = Path(settings.MASKS_ROOT) / request.tag

        samples_tag_path.mkdir(parents=True, exist_ok=True)
        masks_tag_path.mkdir(parents=True, exist_ok=True)

        # 生成唯一ID
        sample_id = f"{request.tag}_{uuid.uuid4().hex[:8]}"

        # 保存图片
        image_data = base64.b64decode(_strip_data_url_prefix(request.image_base64))
        image_path = samples_tag_path / f"{sample_id}.png"
        image_path.write_bytes(image_data)

        # 保存掩码
        mask_path = None
        if request.mask_base64:
            mask_data = base64.b64decode(_strip_data_url_prefix(request.mask_base64))
            mask_path = masks_tag_path / f"{sample_id}.png"
            mask_path.write_bytes(mask_data)

        # 创建样本信息
        sample_info = {
            "id": sample_id,
            "name": request.name,
            "filename": f"{sample_id}.png",
            "tag": request.tag,
            "image_path": f"{request.tag}/{sample_id}.png",
            "mask_path": f"{request.tag}/{sample_id}.png" if mask_path else None,
            "roi_points": request.roi_points,
            "description": request.description,
            "created_at": datetime.now().isoformat(),
            "size": len(image_data)
        }

        # 保存JSON信息
        info_path = samples_tag_path / f"{sample_id}.json"
        with open(info_path, 'w', encoding='utf-8') as f:
            json.dump(sample_info, f, ensure_ascii=False, indent=2)

        return {
            "status": "success",
            "sample_id": sample_id,
            "sample_info": sample_info,
            "message": "示例图片上传成功"
        }

    except Exception as e:
        logger.error(f"上传示例图片失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 按标签查询示例图片 ====================
@app.get("/samples/tag/{tag_name}")
async def get_samples_by_tag(tag_name: str):
    """获取指定标签下的所有示例图片"""
    try:
        tag_path = os.path.join(settings.SAMPLES_ROOT, tag_name)

        if not os.path.exists(tag_path):
            return {
                "status": "success",
                "samples": [],
                "count": 0,
                "tag": tag_name
            }

        samples = []

        # 扫描所有JSON信息文件
        for filename in os.listdir(tag_path):
            if filename.endswith('.json') and not filename.startswith('.tag_info'):
                info_path = os.path.join(tag_path, filename)
                try:
                    with open(info_path, 'r', encoding='utf-8') as f:
                        sample_info = json.load(f)

                    # 构建完整的URL路径
                    sample_info["image_url"] = f"/samples/{tag_name}/{sample_info['filename']}"
                    sample_info["mask_url"] = f"/masks/{tag_name}/{sample_info['filename']}"

                    samples.append(sample_info)
                except Exception as e:
                    logger.error(f"读取样本信息失败 {info_path}: {str(e)}")
                    continue

        # 按创建时间排序
        samples.sort(key=lambda x: x.get("created_at", ""), reverse=True)

        return {
            "status": "success",
            "samples": samples,
            "count": len(samples),
            "tag": tag_name
        }
    except Exception as e:
        logger.error(f"获取标签样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 重命名示例图片 ====================
@app.post("/samples/{sample_id}/rename")
async def rename_sample(sample_id: str, request: RenameRequest):
    """重命名示例图片"""
    try:
        # 查找样本信息文件
        sample_info = None
        sample_path = None

        for root, dirs, files in os.walk(settings.SAMPLES_ROOT):
            for file in files:
                if file == f"{sample_id}.json":
                    sample_path = os.path.join(root, file)
                    with open(sample_path, 'r', encoding='utf-8') as f:
                        sample_info = json.load(f)
                    break
            if sample_info:
                break

        if not sample_info:
            raise HTTPException(status_code=404, detail="样本不存在")

        # 更新样本名称
        sample_info["name"] = request.name
        sample_info["updated_at"] = datetime.now().isoformat()

        # 保存更新
        with open(sample_path, 'w', encoding='utf-8') as f:
            json.dump(sample_info, f, ensure_ascii=False, indent=2)

        logger.info(f"重命名样本成功: {sample_id} -> {request.name}")
        return {
            "status": "success",
            "message": "重命名成功"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"重命名样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 获取单个样本详情 ====================
@app.get("/samples/{sample_id}")
async def get_sample_detail(sample_id: str):
    """获取单个样本的详细信息"""
    try:
        # 查找样本信息文件
        sample_info = None
        sample_path = None

        for root, dirs, files in os.walk(settings.SAMPLES_ROOT):
            for file in files:
                if file == f"{sample_id}.json":
                    sample_path = os.path.join(root, file)
                    with open(sample_path, 'r', encoding='utf-8') as f:
                        sample_info = json.load(f)
                    break
            if sample_info:
                break

        if not sample_info:
            raise HTTPException(status_code=404, detail="样本不存在")

        # 构建完整的URL路径
        tag_name = sample_info.get("tag", "")
        if tag_name:
            sample_info["image_url"] = f"/examples/{tag_name}/{sample_info['filename']}"
            sample_info["mask_url"] = f"/masks/{tag_name}/{sample_info['filename']}"

        return {
            "status": "success",
            "sample": sample_info
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取样本详情失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 删除示例图片 ====================
@app.delete("/samples/{sample_id}")
async def delete_sample(sample_id: str):
    """删除示例图片（删除原图、掩码和信息文件）"""
    try:
        # 查找样本信息文件
        sample_info = None
        sample_path = None
        sample_root = None

        for root, dirs, files in os.walk(settings.SAMPLES_ROOT):
            for file in files:
                if file == f"{sample_id}.json":
                    sample_path = os.path.join(root, file)
                    sample_root = root
                    with open(sample_path, 'r', encoding='utf-8') as f:
                        sample_info = json.load(f)
                    break
            if sample_info:
                break

        if not sample_info:
            raise HTTPException(status_code=404, detail="样本不存在")

        tag_name = sample_info.get("tag", "")

        # 删除原图
        if "filename" in sample_info:
            image_path = os.path.join(sample_root, sample_info["filename"])
            if os.path.exists(image_path):
                os.remove(image_path)

        # 删除掩码
        if tag_name and "filename" in sample_info:
            mask_root = os.path.join(settings.MASKS_ROOT, tag_name)
            mask_path = os.path.join(mask_root, sample_info["filename"])
            if os.path.exists(mask_path):
                os.remove(mask_path)

        # 删除信息文件
        if sample_path and os.path.exists(sample_path):
            os.remove(sample_path)

        # 更新标签信息
        if tag_name:
            tag_info_path = os.path.join(settings.SAMPLES_ROOT, tag_name, ".tag_info.json")
            if os.path.exists(tag_info_path):
                with open(tag_info_path, 'r', encoding='utf-8') as f:
                    tag_info = json.load(f)

                tag_info["samples_count"] = max(0, tag_info.get("samples_count", 1) - 1)
                tag_info["updated_at"] = datetime.now().isoformat()

                with open(tag_info_path, 'w', encoding='utf-8') as f:
                    json.dump(tag_info, f, ensure_ascii=False, indent=2)

        logger.info(f"删除样本成功: {sample_id}")
        return {
            "status": "success",
            "message": "样本删除成功"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 获取所有示例图片（支持标签过滤） ====================
@app.get("/samples")
async def get_all_samples(
        tag: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
):
    """获取所有示例图片（可选标签过滤）"""
    try:
        all_samples = []

        for root, dirs, files in os.walk(settings.SAMPLES_ROOT):
            # 跳过根目录
            if root == settings.SAMPLES_ROOT:
                continue

            # 提取标签名
            tag_name = os.path.relpath(root, settings.SAMPLES_ROOT)

            # 如果指定了标签，只处理该标签
            if tag and tag != tag_name:
                continue

            # 处理JSON信息文件
            for file in files:
                if file.endswith('.json') and not file.startswith('.tag_info'):
                    info_path = os.path.join(root, file)
                    try:
                        with open(info_path, 'r', encoding='utf-8') as f:
                            sample_info = json.load(f)

                        # 确保包含标签信息
                        sample_info["tag"] = tag_name
                        sample_info["image_url"] = f"/samples/{tag_name}/{sample_info.get('filename', '')}"
                        sample_info["mask_url"] = f"/masks/{tag_name}/{sample_info.get('filename', '')}"

                        all_samples.append(sample_info)
                    except Exception as e:
                        logger.error(f"读取样本信息失败 {info_path}: {str(e)}")
                        continue

        # 按创建时间排序
        all_samples.sort(key=lambda x: x.get("created_at", ""), reverse=True)

        # 分页
        paginated_samples = all_samples[skip:skip + limit]

        return {
            "status": "success",
            "samples": paginated_samples,
            "count": len(paginated_samples),
            "total": len(all_samples),
            "tag": tag
        }
    except Exception as e:
        logger.error(f"获取所有样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 样本管理接口（旧版本兼容） ====================
@app.post("/samples/save")
async def save_sample(request: SaveSampleRequest):
    """保存样本（旧版本兼容）"""
    try:
        if feature_extractor is None:
            raise HTTPException(status_code=500, detail="特征提取器未初始化")

        # 提取特征
        img = base64_to_pil_image(request.image_base64, mode="RGB")
        ensure_256x256(img, "image")

        mask = None
        if request.mask_base64:
            mask = base64_to_pil_image(request.mask_base64, mode="L")
            ensure_256x256(mask, "mask")

        features_np = feature_extractor.extract_features(img, mask)
        features = features_np.tolist() if features_np is not None else None

        # 生成样本ID
        sample_id = f"{request.phase}_{uuid.uuid4().hex[:8]}"

        # 保存样本
        saved_id = sample_manager.save_sample(
            sample_id=sample_id,
            name=request.name,
            image_base64=request.image_base64,
            mask_base64=request.mask_base64,
            year=request.year,
            phase=request.phase,
            tags=request.tags,
            roi_points=request.roi_points,
            coordinates=request.coordinates,
            features=features
        )

        return {
            "status": "success",
            "sample_id": saved_id,
            "message": "样本保存成功"
        }

    except Exception as e:
        logger.error(f"保存样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/samples/phase/{phase}")
async def get_samples_by_phase(phase: str):
    """按相位获取样本（旧版本兼容）"""
    try:
        samples = sample_manager.get_samples_by_phase(phase)
        return {
            "status": "success",
            "samples": samples,
            "count": len(samples)
        }
    except Exception as e:
        logger.error(f"获取{phase}相位样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/samples_with_roi/{phase}")
async def get_samples_with_roi(phase: str):
    """获取有ROI的样本（旧版本兼容）"""
    try:
        samples = sample_manager.get_samples_with_roi_by_phase(phase)
        return {
            "status": "success",
            "samples": samples,
            "count": len(samples)
        }
    except Exception as e:
        logger.error(f"获取{phase}相位ROI样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/save_sample_from_roi")
async def save_sample_from_roi(request: SaveROISampleRequest):
    """从地图ROI保存样本（旧版本兼容）"""
    try:
        if screenshot_generator is None:
            raise HTTPException(status_code=500, detail="截图生成器未初始化")

        if feature_extractor is None:
            raise HTTPException(status_code=500, detail="特征提取器未初始化")

        # 生成截图
        image, mask, _ = screenshot_generator.generate_screenshot_and_mask(
            polygon=request.polygon,
            zoom=settings.DEFAULT_ZOOM,
            output_size=256,  # 固定256×256
            year=request.year
        )

        image_base64 = screenshot_generator.image_to_base64(image)
        mask_base64 = screenshot_generator.image_to_base64(mask)

        # 提取特征
        features_np = feature_extractor.extract_features(image, mask)
        features = features_np.tolist() if features_np is not None else None

        # 生成样本ID
        sample_id = f"{request.phase}_roi_{uuid.uuid4().hex[:8]}"

        # 保存样本
        saved_id = sample_manager.save_sample(
            sample_id=sample_id,
            name=request.name,
            image_base64=image_base64,
            mask_base64=mask_base64,
            year=request.year,
            phase=request.phase,
            tags=request.tags,
            coordinates=request.polygon,
            features=features
        )

        return {
            "status": "success",
            "sample_id": saved_id,
            "message": "样本保存成功",
            "image_base64": image_base64,
            "mask_base64": mask_base64,
            "year": request.year
        }

    except Exception as e:
        logger.error(f"从ROI保存样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/samples/{sample_id}/info")
async def get_sample_info(sample_id: str):
    """获取样本信息（旧版本兼容）"""
    try:
        sample = sample_manager.get_sample(sample_id)
        if not sample:
            raise HTTPException(status_code=404, detail="样本不存在")

        return {
            "status": "success",
            "sample": sample
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取样本信息失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/samples/delete/{sample_id}")
async def delete_sample_old(sample_id: str):
    """删除样本（旧版本兼容）"""
    try:
        success = sample_manager.delete_sample(sample_id)
        if not success:
            raise HTTPException(status_code=404, detail="样本不存在")

        return {
            "status": "success",
            "message": "样本删除成功"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate_and_search")
async def generate_and_search(request: PolygonRequest):
    """生成截图并搜索"""
    screenshot_res = await generate_screenshot(request)
    features = screenshot_res.get("features")

    if not features:
        return {"status": "partial_success", "screenshot_info": screenshot_res, "message": "特征提取失败"}

    if isinstance(features[0], list):
        features = list(itertools.chain(*features))

    search_res = await search_similar({
        "features": features,
        "year": screenshot_res.get("year", settings.DEFAULT_YEAR)
    })

    return {
        "status": "success",
        "screenshot_info": screenshot_res,
        "search_results": search_res,
        "message": "一站式搜索完成"
    }


@app.post("/generate_and_search_top_n_target")
async def generate_and_search_top_n_target(request: PolygonRequest,
                                           target_params: SearchRequest = Body(..., embed=True)):
    """一站式：生成截图 + TopN聚合"""
    screenshot_res = await generate_screenshot(request)
    features = screenshot_res.get("features")

    if not features:
        return {"status": "partial_success", "screenshot_info": screenshot_res, "message": "特征提取失败"}

    if isinstance(features[0], list):
        features = list(itertools.chain(*features))

    target_params.features = features
    target_params.year = screenshot_res.get("year", settings.DEFAULT_YEAR)

    search_res = await search_top_n_target(target_params)

    return {
        "status": "success",
        "screenshot_info": screenshot_res,
        "search_results": search_res,
        "message": "一站式搜索完成"
    }


@app.get("/tile/{year}/{z}/{x}/{y}.png")
async def get_tile(year: int, z: int, x: int, y: int):
    """获取指定年份的瓦片"""
    tile_path = os.path.join(settings.TILES_ROOT, str(year), str(z), str(x), f"{y}.png")

    if not os.path.exists(tile_path):
        img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)
        from fastapi.responses import Response
        return Response(content=buffer.getvalue(), media_type="image/png")

    return FileResponse(tile_path)


# ==================== 新增：基于样本ID的以图搜图接口 ====================


class SampleImageSearchRequest(BaseModel):
    """样本图片搜索请求"""
    sample_id: str  # 样本ID
    year: int  # 搜索年份
    top_n: int = 1000  # 候选数量
    min_similarity: float = 0.2  # 最小相似度阈值

    class Config:
        # 允许额外字段，避免验证错误
        extra = "allow"


@app.post("/search_by_sample_image")
async def search_by_sample_image(request: SampleImageSearchRequest):
    """
    基于样本ID的以图搜图接口
    """
    try:
        # 添加详细日志，查看接收到的请求
        logger.info(
            f"接收到请求: sample_id={request.sample_id}, year={request.year}, top_n={request.top_n}, min_similarity={request.min_similarity}")

        # 打印完整的请求体（如果需要）
        # import json
        # body = await request.body()
        # logger.info(f"原始请求体: {body.decode()}")

        if feature_extractor is None:
            raise HTTPException(status_code=500, detail="特征提取器未初始化")

        # 1. 获取样本特征
        features = await get_sample_features(request.sample_id)

        if features is None:
            raise HTTPException(status_code=404, detail=f"样本特征获取失败: {request.sample_id}")

        # 2. 确保特征向量是归一化的
        features_np = np.array(features)
        features_norm = normalize_features(features_np)

        logger.info(f"获取样本特征: 维度={features_norm.shape}, 范数={np.linalg.norm(features_norm):.4f}")

        # 3. 在指定年份的影像中检索相似图斑
        results = await DatabaseManager.search_similar_vectors(
            query_vector=features_norm.tolist(),
            limit=request.top_n,
            year=request.year,
            month=None
        )

        if not results:
            return {
                "status": "success",
                "targets": [],
                "message": f"未在{request.year}年找到匹配图斑",
                "total_patches": 0,
                "total_targets": 0
            }

        logger.info(f"检索到 {len(results)} 个候选图斑")

        # 4. 应用最小相似度阈值
        filtered_patches = [p for p in results if p["similarity"] >= request.min_similarity]

        if not filtered_patches:
            return {
                "status": "success",
                "targets": [],
                "message": f"未找到满足最小相似度阈值({request.min_similarity})的图斑",
                "total_patches": len(results),
                "total_targets": 0
            }

        logger.info(f"阈值过滤后剩余 {len(filtered_patches)} 个图斑")

        # 5. 空间聚类聚合
        logger.info(f"空间聚类聚合 {len(filtered_patches)} 个图斑...")
        aggregates = TargetAggregator.aggregate_by_touch(filtered_patches)

        logger.info(f"聚合为 {len(aggregates)} 个目标")

        # 6. 构建返回结果
        target_results = []
        for i, aggregate_patches in enumerate(aggregates):
            if not aggregate_patches:
                continue

            aggregate_info = TargetAggregator.calculate_aggregate_info(aggregate_patches, zoom=18)
            geo = TargetAggregator.union_geometry_geojson(aggregate_patches, zoom=18)

            patch_count = len(aggregate_patches)
            avg_similarity = sum(p["similarity"] for p in aggregate_patches) / patch_count
            max_similarity = max(p["similarity"] for p in aggregate_patches)

            thumbnail = None
            if thumbnail_generator and aggregate_patches:
                best_patch = max(aggregate_patches, key=lambda x: x.get("similarity", 0))
                try:
                    thumbnail = thumbnail_generator.generate_patch_thumbnail(best_patch, zoom=18)
                except Exception as e:
                    logger.error(f"生成缩略图失败: {str(e)}")

            target_results.append({
                "target_id": i + 1,
                "geometry": geo,
                "bounds": aggregate_info["bounds"],
                "center": aggregate_info["center"],
                "patch_count": patch_count,
                "max_similarity": max_similarity,
                "avg_similarity": avg_similarity,
                "similarity": avg_similarity,
                "thumbnail": thumbnail,
                "patches": aggregate_patches,
                "year": request.year
            })

        target_results.sort(key=lambda x: x["similarity"], reverse=True)

        return {
            "status": "success",
            "total_patches": len(filtered_patches),
            "total_targets": len(aggregates),
            "targets": target_results,
            "message": f"搜索完成: {request.year}年，找到 {len(target_results)} 个目标"
        }

    except Exception as e:
        logger.error(f"样本图片搜索失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app="__main__:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=settings.DEBUG,
        workers=1
    )