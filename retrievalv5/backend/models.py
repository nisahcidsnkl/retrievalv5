# -*- coding: utf-8 -*-
"""
Pydantic 数据模型
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel


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


class SampleImageSearchRequest(BaseModel):
    """样本图片搜索请求"""
    sample_id: str  # 样本ID
    year: int  # 搜索年份
    top_n: int = 1000  # 候选数量
    min_similarity: float = 0.2  # 最小相似度阈值

    class Config:
        # 允许额外字段，避免验证错误
        extra = "allow"