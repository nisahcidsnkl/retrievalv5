# -*- coding: utf-8 -*-
"""
健康检查路由
"""

import logging
import os
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from database import DatabaseManager, db_pool
from config import settings


logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
async def health_check(request_obj: Request):
    """健康检查接口"""
    # 从 app.state 获取全局变量
    feature_extractor = request_obj.app.state.feature_extractor
    sample_manager = request_obj.app.state.sample_manager

    count = await DatabaseManager.get_feature_count()
    available_years = await DatabaseManager.get_available_years()

    # 安全获取样本数量
    samples_count = 0
    if sample_manager is not None:
        try:
            samples_count = len(sample_manager.get_all_samples())
        except Exception as e:
            logger.warning(f"获取样本数量失败: {str(e)}")
            samples_count = 0

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
        "samples_count": samples_count
    }


@router.get("/available_years")
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
        raise