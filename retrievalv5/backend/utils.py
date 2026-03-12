# -*- coding: utf-8 -*-
"""
工具函数模块
"""

import math
from typing import Tuple, List

import numpy as np
from fastapi import HTTPException

from config import CURRENT_CONFIG, TILE_PIXEL_SIZE, PIXELS_PER_GRID


def normalize_features(features: np.ndarray) -> np.ndarray:
    """归一化特征向量"""
    norm = np.linalg.norm(features)
    if norm > 0:
        return features / norm
    else:
        return features


def strip_data_url_prefix(b64: str) -> str:
    """移除base64 data URL前缀"""
    if not b64:
        return b64
    if "," in b64 and b64.strip().startswith("data:"):
        return b64.split(",", 1)[1]
    return b64


def base64_to_pil_image(b64: str, mode: str = "RGB"):
    """将base64字符串转换为PIL图像"""
    import io
    import base64
    from PIL import Image

    try:
        b64 = strip_data_url_prefix(b64)
        raw = base64.b64decode(b64)
        img = Image.open(io.BytesIO(raw))
        img.load()
        return img.convert(mode)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"base64图片解码失败: {str(e)}")


def ensure_256x256(img, name: str) -> None:
    """确保图像尺寸为256x256"""
    if img.size != (256, 256):
        raise HTTPException(status_code=400, detail=f"{name} 尺寸必须为 256x256，当前: {img.size}")


class CoordinateConverter:
    """坐标转换工具类"""

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


class UnionFind:
    """并查集工具类"""

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