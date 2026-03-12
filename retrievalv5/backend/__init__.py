# -*- coding: utf-8 -*-
"""
后端模块包
"""

import sys
from pathlib import Path

# 确保 backend 目录在 sys.path 中
backend_dir = Path(__file__).parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from config import settings, CURRENT_CONFIG, FEATURE_DIM
from database import DatabaseManager, db_pool
from models import *
from extractors import DINOv3FeatureExtractor
from image_tools import ThumbnailGenerator, PolygonScreenshotGenerator
from sample_manager import SampleManager
from aggregation import TargetAggregator

__all__ = [
    'settings',
    'CURRENT_CONFIG',
    'FEATURE_DIM',
    'DatabaseManager',
    'db_pool',
    'DINOv3FeatureExtractor',
    'ThumbnailGenerator',
    'PolygonScreenshotGenerator',
    'SampleManager',
    'TargetAggregator',
]