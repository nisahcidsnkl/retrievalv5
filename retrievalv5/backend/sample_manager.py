# -*- coding: utf-8 -*-
"""
样本管理模块
"""

import os
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path

from utils import strip_data_url_prefix
from config import settings


logger = logging.getLogger(__name__)


class SampleManager:
    """样本管理器"""

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
        import base64

        try:
            # 创建目录
            phase_dir = self.samples_root / phase
            phase_dir.mkdir(exist_ok=True)
            mask_phase_dir = self.masks_root / phase
            mask_phase_dir.mkdir(exist_ok=True)

            # 保存图片
            image_data = base64.b64decode(strip_data_url_prefix(image_base64))
            image_path = phase_dir / f"{sample_id}.png"
            with open(image_path, 'wb') as f:
                f.write(image_data)

            # 保存掩码
            mask_path = None
            if mask_base64:
                mask_data = base64.b64decode(strip_data_url_prefix(mask_base64))
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
            raise

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