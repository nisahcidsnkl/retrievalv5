# -*- coding: utf-8 -*-
"""
图像处理工具模块
"""

import io
import os
import base64
import logging
from typing import Dict, Any, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from config import settings
from utils import CoordinateConverter


logger = logging.getLogger(__name__)


class ThumbnailGenerator:
    """缩略图生成器"""

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


class PolygonScreenshotGenerator:
    """多边形截图生成器"""

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

    def calculate_polygon_bounds(self, polygon: list, zoom: int) -> Dict[str, Any]:
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

    def generate_screenshot_and_mask(self, polygon: list, zoom: int = 18,
                                     output_size: int = 256, year: int = None):
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

    def generate_rectangle_screenshot(self, bounds: Dict[str, float], zoom: int = 18, year: int = None) -> Image.Image:
        """
        生成矩形框截图（保持原始比例，不缩放）

        Args:
            bounds: 矩形框边界 {min_lat, min_lng, max_lat, max_lng}
            zoom: 缩放级别
            year: 年份

        Returns:
            截图图像
        """
        if year is None:
            year = settings.DEFAULT_YEAR

        min_lat = bounds.get("min_lat")
        min_lng = bounds.get("min_lng")
        max_lat = bounds.get("max_lat")
        max_lng = bounds.get("max_lng")

        # 转换为像素坐标
        min_x, min_y = CoordinateConverter.latlng_to_pixel(min_lat, min_lng, zoom)
        max_x, max_y = CoordinateConverter.latlng_to_pixel(max_lat, max_lng, zoom)

        # 确保min和max顺序正确
        min_x, max_x = min(min_x, max_x), max(min_x, max_x)
        min_y, max_y = min(min_y, max_y), max(min_y, max_y)

        # 计算需要的瓦片
        tile_min_col, tile_min_row = CoordinateConverter.pixel_to_tile(min_x, min_y)
        tile_max_col, tile_max_row = CoordinateConverter.pixel_to_tile(max_x, max_y)

        # 创建拼接图像
        tile_cols = tile_max_col - tile_min_col + 1
        tile_rows = tile_max_row - tile_min_row + 1
        mosaic_width = tile_cols * 256
        mosaic_height = tile_rows * 256
        mosaic_image = Image.new("RGB", (mosaic_width, mosaic_height))

        # 加载并拼接瓦片
        for col in range(tile_min_col, tile_max_col + 1):
            for row in range(tile_min_row, tile_max_row + 1):
                tile_img = self.load_tile(year, zoom, col, row)
                mosaic_x = (col - tile_min_col) * 256
                mosaic_y = (row - tile_min_row) * 256
                mosaic_image.paste(tile_img, (mosaic_x, mosaic_y))

        # 计算在拼接图像中的裁剪坐标
        crop_x1 = int(min_x - tile_min_col * 256)
        crop_y1 = int(min_y - tile_min_row * 256)
        crop_x2 = int(max_x - tile_min_col * 256)
        crop_y2 = int(max_y - tile_min_row * 256)

        # 裁剪出目标区域
        final_image = mosaic_image.crop((crop_x1, crop_y1, crop_x2, crop_y2))

        return final_image

    def image_to_base64(self, image: Image.Image) -> str:
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        buffer.seek(0)
        return base64.b64encode(buffer.read()).decode('utf-8')