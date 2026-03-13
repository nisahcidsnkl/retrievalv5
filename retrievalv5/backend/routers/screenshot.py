# -*- coding: utf-8 -*-
"""
截图相关路由
"""

import logging
import base64
import json
import io
from typing import Dict, Any, Optional
from pathlib import Path

import numpy as np
from PIL import Image
from fastapi import APIRouter, HTTPException, Body, Request
from pydantic import BaseModel

from database import DatabaseManager
from image_tools import ThumbnailGenerator, PolygonScreenshotGenerator
from config import settings, TILE_PIXEL_SIZE
from utils import base64_to_pil_image, CoordinateConverter


logger = logging.getLogger(__name__)

router = APIRouter()


class RectScreenshotRequest(BaseModel):
    """矩形框截图请求"""
    bounds: Dict[str, float]  # {min_lat, min_lng, max_lat, max_lng}
    zoom: int = 18  # 缩放级别
    years: list[int]  # 需要截取的年份列表


@router.post("/screenshot_rect")
async def screenshot_rect(req: RectScreenshotRequest, request: Request):
    """
    根据矩形框截取多个时相的图像

    Args:
        req: 矩形框截图请求

    Returns:
        {
            "status": "success",
            "images": {
                "2023": "base64_image",
                "2025": "base64_image"
            }
        }
    """
    try:
        app = request.app
        screenshot_generator = app.state.screenshot_generator

        if not screenshot_generator:
            raise HTTPException(status_code=500, detail="截图生成器未初始化")

        # 获取矩形框边界
        min_lat = req.bounds.get("min_lat")
        min_lng = req.bounds.get("min_lng")
        max_lat = req.bounds.get("max_lat")
        max_lng = req.bounds.get("max_lng")

        if not all([min_lat, min_lng, max_lat, max_lng]):
            raise HTTPException(status_code=400, detail="矩形框边界参数不完整")

        # 转换为多边形坐标
        polygon_coords = [
            [min_lat, min_lng],
            [min_lat, max_lng],
            [max_lat, max_lng],
            [max_lat, min_lng],
            [min_lat, min_lng]  # 闭合多边形
        ]

        images = {}

        # 为每个年份生成截图
        for year in req.years:
            try:
                # 使用新的矩形框截图方法（保持原始比例）
                final_image = screenshot_generator.generate_rectangle_screenshot(
                    bounds=req.bounds,
                    zoom=req.zoom,
                    year=year
                )

                # 将图像转换为base64
                if final_image:
                    image_base64 = screenshot_generator.image_to_base64(final_image)
                    images[str(year)] = image_base64
                else:
                    logger.warning(f"年份 {year} 的截图生成失败")
                    images[str(year)] = None

            except Exception as e:
                logger.error(f"生成年份 {year} 的截图时出错: {str(e)}")
                images[str(year)] = None

        return {
            "status": "success",
            "images": images,
            "bounds": req.bounds,
            "years": req.years
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"截图处理失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"截图处理失败: {str(e)}")


@router.post("/save_screenshot")
async def save_screenshot(
    request: Request,
    main_scene: str = Body(..., embed=True),
    sub_scene: str = Body(..., embed=True),
    description: str = Body(..., embed=True),
    images: Dict[str, str] = Body(..., embed=True)
):
    """
    保存截图和描述信息

    Args:
        main_scene: 主场景
        sub_scene: 子场景
        description: 描述文本
        images: 图像数据 {year: base64_image}

    Returns:
        {
            "status": "success",
            "save_path": "data/主场景/子场景/1/"
        }
    """
    try:
        # 创建保存路径
        base_path = Path(settings.TILES_ROOT).parent.parent  # retrievalv5 目录
        data_path = base_path / "data" / main_scene / sub_scene

        # 如果主场景或子场景文件夹不存在，创建它们
        if not data_path.exists():
            data_path.mkdir(parents=True, exist_ok=True)

        # 获取当前该子场景下的最大序号
        max_seq = 0
        for item in data_path.iterdir():
            if item.is_dir() and item.name.isdigit():
                seq = int(item.name)
                if seq > max_seq:
                    max_seq = seq

        # 创建新的序号文件夹
        new_seq = max_seq + 1
        save_path = data_path / str(new_seq)
        save_path.mkdir(exist_ok=True)

        # 保存图像
        image_files = []
        for year, base64_image in images.items():
            if base64_image:
                # 移除 data URL 前缀（如果有）
                if base64_image.startswith("data:image"):
                    base64_image = base64_image.split(",", 1)[1]

                # 解码并保存图像
                image_data = base64.b64decode(base64_image)
                image = Image.open(io.BytesIO(image_data))

                image_filename = f"{year}年.png"
                image_path = save_path / image_filename
                image.save(image_path, format="PNG")
                image_files.append(image_filename)

        # 保存描述文本
        desc_filename = "描述文本.txt"
        desc_path = save_path / desc_filename
        with open(desc_path, "w", encoding="utf-8") as f:
            f.write(description)

        return {
            "status": "success",
            "save_path": str(save_path),
            "image_files": image_files,
            "description_file": desc_filename
        }

    except Exception as e:
        logger.error(f"保存截图失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"保存截图失败: {str(e)}")