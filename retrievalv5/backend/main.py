# -*- coding: utf-8 -*-
"""
FastAPI 应用入口 - 模块化版本
"""

import os
import sys
import logging
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

# 添加 backend 目录到 Python 路径
backend_dir = Path(__file__).parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from database import DatabaseManager
from extractors import DINOv3FeatureExtractor
from image_tools import ThumbnailGenerator, PolygonScreenshotGenerator
from sample_manager import SampleManager
import routers


# ==================== 日志配置 ====================
def setup_logger():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        stream=sys.stdout
    )
    return logging.getLogger(__name__)


logger = setup_logger()


# ==================== 生命周期管理 ====================
@asynccontextmanager
async def lifespan(app: FastAPI):
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
        feature_extractor = None

    screenshot_generator = PolygonScreenshotGenerator(settings.TILES_ROOT)
    thumbnail_generator = ThumbnailGenerator(settings.TILES_ROOT)
    sample_manager = SampleManager(settings.SAMPLES_ROOT, settings.MASKS_ROOT)

    # 将全局变量存储到 app.state
    app.state.feature_extractor = feature_extractor
    app.state.screenshot_generator = screenshot_generator
    app.state.thumbnail_generator = thumbnail_generator
    app.state.sample_manager = sample_manager

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


# ==================== 创建应用 ====================
app = FastAPI(
    title="全域AI图侦系统后端（多年份版）",
    lifespan=lifespan
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# 挂载静态文件
# 挂载前端页面目录（静态文件）
frontend_dir = Path(__file__).parent.parent  # backend 的父目录
app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

app.mount("/tiles", StaticFiles(directory=settings.TILES_ROOT), name="tiles")
app.mount("/examples", StaticFiles(directory=settings.SAMPLES_ROOT), name="examples")
app.mount("/masks", StaticFiles(directory=settings.MASKS_ROOT), name="masks")

# 注册路由
app.include_router(routers.health.router, tags=["健康检查"])
app.include_router(routers.search.router, tags=["搜索"])
app.include_router(routers.samples.router, tags=["样本管理"])
app.include_router(routers.screenshot.router, tags=["截图"])

# 依赖注入
@app.get("/")
async def root():
    """重定向到前端页面"""
    return RedirectResponse(url="/static/index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=settings.DEBUG,
        workers=1,
        limit_concurrency=20,  # 限制并发连接数
        timeout_keep_alive=5,  # 5秒后关闭空闲连接
        timeout_graceful_shutdown=10  # 优雅关闭超时
    )