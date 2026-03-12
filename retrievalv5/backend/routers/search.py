# -*- coding: utf-8 -*-
"""
搜索相关路由
"""

import logging
import traceback
import itertools
import httpx
import json
import uuid
import io
import base64
import sys
from typing import Dict, Any, Optional
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image
from fastapi import APIRouter, HTTPException, Body, Request
from pydantic import BaseModel

# 使用绝对导入（sys.path 已包含 backend 目录）
from database import DatabaseManager
from extractors import DINOv3FeatureExtractor
from image_tools import ThumbnailGenerator, PolygonScreenshotGenerator
from aggregation import TargetAggregator
from sample_manager import SampleManager
from config import settings, CURRENT_CONFIG, FEATURE_DIM, TILE_PIXEL_SIZE
from models import *
from utils import normalize_features, strip_data_url_prefix, base64_to_pil_image, ensure_256x256, CoordinateConverter


logger = logging.getLogger(__name__)

router = APIRouter()


class GeocodeRequest(BaseModel):
    q: str


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


@router.post("/geocode")
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


@router.post("/generate_screenshot")
async def generate_screenshot(req: PolygonRequest, request_obj: Request):
    """生成截图（支持指定年份）"""
    try:
        # 从 app.state 获取全局变量
        screenshot_generator = request_obj.app.state.screenshot_generator
        feature_extractor = request_obj.app.state.feature_extractor

        if screenshot_generator is None:
            logger.error("截图生成器未初始化")
            raise HTTPException(status_code=500, detail="截图生成器未初始化，请确保后端服务已完全启动")

        year = req.year or settings.DEFAULT_YEAR

        image, mask, transform_info = screenshot_generator.generate_screenshot_and_mask(
            polygon=req.polygon,
            zoom=req.zoom,
            output_size=req.output_size,
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
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"截图生成失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/extract_features")
async def extract_features(req: ExtractFeaturesRequest, request_obj: Request):
    """提取特征"""
    try:
        # 从 app.state 获取全局变量
        feature_extractor = request_obj.app.state.feature_extractor

        if feature_extractor is None:
            logger.error("特征提取器未初始化")
            raise HTTPException(status_code=500, detail="特征提取器未初始化，请确保后端服务已完全启动")

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


@router.post("/search_similar")
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


@router.post("/search_by_year")
async def search_by_year(req: YearSearchRequest):
    """按年份搜索"""
    try:
        if len(req.features) != FEATURE_DIM:
            raise HTTPException(status_code=400, detail="特征维度错误")

        results = await DatabaseManager.search_similar_vectors(
            req.features,
            limit=req.top_n,
            year=req.year,
            month=req.month
        )

        if not results:
            return {
                "status": "success",
                "results": [],
                "year": req.year,
                "month": req.month,
                "message": f"未在{req.year}年找到匹配图斑"
            }

        return {
            "status": "success",
            "results": results,
            "year": req.year,
            "month": req.month,
            "total_matched": len(results),
            "message": f"在{req.year}年找到 {len(results)} 个匹配图斑"
        }
    except Exception as e:
        logger.error(f"按年份搜索失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search_top_n_target")
async def search_top_n_target(req: SearchRequest, request_obj: Request):
    """目标聚合搜索"""
    try:
        # 从 app.state 获取全局变量
        thumbnail_generator = request_obj.app.state.thumbnail_generator

        if len(req.features) != FEATURE_DIM:
            raise HTTPException(status_code=400, detail="特征维度错误")

        top_n = max(50, min(500, req.top_n))
        year = req.year

        top_n_results = await DatabaseManager.search_similar_vectors(
            req.features,
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
                try:
                    thumbnail = thumbnail_generator.generate_patch_thumbnail(best_patch, zoom=18)
                except Exception as e:
                    logger.warning(f"生成缩略图失败: {str(e)}")

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


# 新增辅助函数：获取样本特征
async def get_sample_features(sample_id: str, sample_manager: SampleManager, feature_extractor: DINOv3FeatureExtractor) -> Optional[np.ndarray]:
    """获取样本特征向量"""
    try:
        # 1. 首先尝试从样本管理器获取
        sample_info = sample_manager.get_sample(sample_id)
        if sample_info and sample_info.get("features"):
            return np.array(sample_info["features"])

        # 2. 如果不存在，从文件系统读取并提取特征
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
                        from PIL import Image
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


@router.post("/change_detection_by_samples")
async def change_detection_by_samples(req: ChangeDetectionBySamplesRequest, request_obj: Request):
    """基于样本特征差的跨时相变化检测"""
    try:
        # 从 app.state 获取全局变量
        feature_extractor = request_obj.app.state.feature_extractor
        sample_manager = request_obj.app.state.sample_manager
        thumbnail_generator = request_obj.app.state.thumbnail_generator

        logger.info(f"特征差变化检测: 样本1={req.sample_id1}, 年份1={req.year1}, "
                    f"样本2={req.sample_id2}, 年份2={req.year2}")

        if feature_extractor is None:
            raise HTTPException(status_code=500, detail="特征提取器未初始化，请确保后端服务已完全启动")

        # 1. 获取前后时相样本特征
        features1 = await get_sample_features(req.sample_id1, sample_manager, feature_extractor)
        features2 = await get_sample_features(req.sample_id2, sample_manager, feature_extractor)

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
        sample_diff_norm = sample_diff

        logger.info(f"计算样本特征差: 维度={sample_diff_norm.shape}, 范数={np.linalg.norm(sample_diff_norm)}")

        # 3. 在特征差表中检索相似变化
        results = await DatabaseManager.search_similar_by_diff(
            query_diff_vector=sample_diff_norm.tolist(),
            limit=req.top_n,
            year_before=req.year1,
            year_after=req.year2
        )

        if not results:
            return {
                "status": "success",
                "targets": [],
                "message": f"未在{req.year1}年→{req.year2}年找到相似的变化图斑",
                "total_patches": 0,
                "total_targets": 0
            }

        logger.info(f"特征差检索到 {len(results)} 个候选图斑")

        # 4. 应用最小相似度阈值
        filtered_patches = [p for p in results if p["similarity"] >= req.min_similarity]

        if not filtered_patches:
            return {
                "status": "success",
                "targets": [],
                "message": f"未找到满足最小相似度阈值({req.min_similarity})的变化图斑",
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
            change_score = avg_similarity

            # 生成缩略图（使用前时相年份的瓦片）
            thumbnail = None
            if thumbnail_generator and aggregate_patches:
                best_patch = max(aggregate_patches, key=lambda x: x.get("similarity", 0))

                try:
                    col, row = best_patch["col"], best_patch["row"]
                    patch_col, patch_row = best_patch["patch_col"], best_patch["patch_row"]
                    z = best_patch.get("z", 18)

                    # 加载前时相瓦片
                    tile_img = thumbnail_generator.load_tile(req.year1, z, col, row)

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
                "similarity": avg_similarity,
                "thumbnail": thumbnail,
                "patches": aggregate_patches,
                "year_before": req.year1,
                "year_after": req.year2
            })

        # 按相似度排序
        target_results.sort(key=lambda x: x["change_score"], reverse=True)

        return {
            "status": "success",
            "total_patches": len(filtered_patches),
            "total_targets": len(aggregates),
            "targets": target_results,
            "message": f"特征差变化检测完成: {req.year1}年 → {req.year2}年，找到 {len(target_results)} 个变化目标",
            "debug_info": {
                "sample_diff_norm": float(np.linalg.norm(sample_diff_norm)),
                "retrieved_count": len(results),
                "filtered_count": len(filtered_patches),
                "aggregates_count": len(aggregates),
                "min_similarity": req.min_similarity
            }
        }

    except Exception as e:
        logger.error(f"特征差变化检测失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search_by_sample_image")
async def search_by_sample_image(req: SampleImageSearchRequest, request_obj: Request):
    """
    基于样本ID的以图搜图接口
    """
    try:
        # 从 app.state 获取全局变量
        feature_extractor = request_obj.app.state.feature_extractor
        sample_manager = request_obj.app.state.sample_manager
        thumbnail_generator = request_obj.app.state.thumbnail_generator

        logger.info(
            f"接收到请求: sample_id={req.sample_id}, year={req.year}, top_n={req.top_n}, min_similarity={req.min_similarity}")

        if feature_extractor is None:
            raise HTTPException(status_code=500, detail="特征提取器未初始化，请确保后端服务已完全启动")

        # 1. 获取样本特征
        features = await get_sample_features(req.sample_id, sample_manager, feature_extractor)

        if features is None:
            raise HTTPException(status_code=404, detail=f"样本特征获取失败: {req.sample_id}")

        # 2. 确保特征向量是归一化的
        features_np = np.array(features)
        features_norm = normalize_features(features_np)

        logger.info(f"获取样本特征: 维度={features_norm.shape}, 范数={np.linalg.norm(features_norm):.4f}")

        # 3. 在指定年份的影像中检索相似图斑
        results = await DatabaseManager.search_similar_vectors(
            query_vector=features_norm.tolist(),
            limit=req.top_n,
            year=req.year,
            month=None
        )

        if not results:
            return {
                "status": "success",
                "targets": [],
                "message": f"未在{req.year}年找到匹配图斑",
                "total_patches": 0,
                "total_targets": 0
            }

        logger.info(f"检索到 {len(results)} 个候选图斑")

        # 4. 应用最小相似度阈值
        filtered_patches = [p for p in results if p["similarity"] >= req.min_similarity]

        if not filtered_patches:
            return {
                "status": "success",
                "targets": [],
                "message": f"未找到满足最小相似度阈值({req.min_similarity})的图斑",
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
                "year": req.year
            })

        target_results.sort(key=lambda x: x["similarity"], reverse=True)

        return {
            "status": "success",
            "total_patches": len(filtered_patches),
            "total_targets": len(aggregates),
            "targets": target_results,
            "message": f"搜索完成: {req.year}年，找到 {len(target_results)} 个目标"
        }

    except Exception as e:
        logger.error(f"样本图片搜索失败: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
