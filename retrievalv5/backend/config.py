# -*- coding: utf-8 -*-
"""
配置管理模块
"""

import os
from pydantic_settings import BaseSettings


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
        env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
        env_file_encoding = "utf-8"


settings = Settings()

# 创建样本目录
os.makedirs(settings.SAMPLES_ROOT, exist_ok=True)
os.makedirs(settings.MASKS_ROOT, exist_ok=True)

# 滑窗配置逻辑
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