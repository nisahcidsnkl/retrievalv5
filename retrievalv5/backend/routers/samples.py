# -*- coding: utf-8 -*-
"""
样本和标签管理路由
"""

import os
import json
import logging
import base64
import uuid
import shutil
import sys
from typing import Optional
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

# 使用绝对导入（sys.path 已包含 backend 目录）
from config import settings
from models import TagRequest, RenameRequest, UploadSampleRequest, SaveSampleRequest, SaveROISampleRequest
from extractors import DINOv3FeatureExtractor
from sample_manager import SampleManager
from image_tools import PolygonScreenshotGenerator
from utils import strip_data_url_prefix, base64_to_pil_image, ensure_256x256


logger = logging.getLogger(__name__)

router = APIRouter()


# ==================== 标签管理接口 ====================
@router.get("/tags")
async def get_tags():
    """获取所有标签（samples和masks下的子文件夹名称）"""
    try:
        tags = []

        # 检查samples目录下的子文件夹
        if os.path.exists(settings.SAMPLES_ROOT):
            for item in os.listdir(settings.SAMPLES_ROOT):
                item_path = os.path.join(settings.SAMPLES_ROOT, item)
                if os.path.isdir(item_path):
                    tags.append(item)

        # 确保masks目录下也有相同的标签
        if os.path.exists(settings.MASKS_ROOT):
            for tag in tags:
                tag_path = os.path.join(settings.MASKS_ROOT, tag)
                if not os.path.exists(tag_path):
                    os.makedirs(tag_path, exist_ok=True)

        return {
            "status": "success",
            "tags": sorted(list(set(tags))),
            "count": len(tags)
        }
    except Exception as e:
        logger.error(f"获取标签失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tags")
async def create_tag(request: TagRequest):
    """创建新标签（在samples和masks下创建子文件夹）"""
    try:
        tag_name = request.name.strip()
        if not tag_name:
            raise HTTPException(status_code=400, detail="标签名称不能为空")

        # 创建标签目录
        samples_tag_path = os.path.join(settings.SAMPLES_ROOT, tag_name)
        masks_tag_path = os.path.join(settings.MASKS_ROOT, tag_name)

        os.makedirs(samples_tag_path, exist_ok=True)
        os.makedirs(masks_tag_path, exist_ok=True)

        # 创建标签信息文件
        tag_info = {
            "name": tag_name,
            "created_at": datetime.now().isoformat(),
            "samples_count": 0
        }

        tag_info_path = os.path.join(samples_tag_path, ".tag_info.json")
        with open(tag_info_path, 'w', encoding='utf-8') as f:
            json.dump(tag_info, f, ensure_ascii=False, indent=2)

        logger.info(f"创建标签成功: {tag_name}")
        return {
            "status": "success",
            "tag": tag_name,
            "message": "标签创建成功"
        }
    except Exception as e:
        logger.error(f"创建标签失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/tags/{tag_name}")
async def delete_tag(tag_name: str):
    """删除标签（删除samples和masks下的子文件夹）"""
    try:
        samples_tag_path = os.path.join(settings.SAMPLES_ROOT, tag_name)
        masks_tag_path = os.path.join(settings.MASKS_ROOT, tag_name)

        # 检查是否存在
        if not os.path.exists(samples_tag_path):
            raise HTTPException(status_code=404, detail="标签不存在")

        # 检查是否为空
        def count_files(directory):
            count = 0
            for root, dirs, files in os.walk(directory):
                count += len(files)
            return count

        samples_count = count_files(samples_tag_path)
        masks_count = count_files(masks_tag_path)

        # 减去tag_info文件
        tag_info_file = os.path.join(samples_tag_path, ".tag_info.json")
        if os.path.exists(tag_info_file):
            samples_count -= 1

        if samples_count > 0 or masks_count > 0:
            raise HTTPException(status_code=400, detail="标签下还有文件，无法删除")

        # 删除目录
        shutil.rmtree(samples_tag_path, ignore_errors=True)
        shutil.rmtree(masks_tag_path, ignore_errors=True)

        logger.info(f"删除标签成功: {tag_name}")
        return {
            "status": "success",
            "message": "标签删除成功"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除标签失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 示例图片上传接口（带ROI） ====================
@router.post("/samples/upload")
async def upload_sample_with_roi(request: UploadSampleRequest):
    """上传示例图片并保存ROI掩码（适配前端）"""
    try:
        # 验证标签是否存在或创建
        samples_tag_path = Path(settings.SAMPLES_ROOT) / request.tag
        masks_tag_path = Path(settings.MASKS_ROOT) / request.tag

        samples_tag_path.mkdir(parents=True, exist_ok=True)
        masks_tag_path.mkdir(parents=True, exist_ok=True)

        # 生成唯一ID
        sample_id = f"{request.tag}_{uuid.uuid4().hex[:8]}"

        # 保存图片
        image_data = base64.b64decode(strip_data_url_prefix(request.image_base64))
        image_path = samples_tag_path / f"{sample_id}.png"
        image_path.write_bytes(image_data)

        # 保存掩码
        mask_path = None
        if request.mask_base64:
            mask_data = base64.b64decode(strip_data_url_prefix(request.mask_base64))
            mask_path = masks_tag_path / f"{sample_id}.png"
            mask_path.write_bytes(mask_data)

        # 创建样本信息
        sample_info = {
            "id": sample_id,
            "name": request.name,
            "filename": f"{sample_id}.png",
            "tag": request.tag,
            "image_path": f"{request.tag}/{sample_id}.png",
            "mask_path": f"{request.tag}/{sample_id}.png" if mask_path else None,
            "roi_points": request.roi_points,
            "description": request.description,
            "created_at": datetime.now().isoformat(),
            "size": len(image_data)
        }

        # 保存JSON信息
        info_path = samples_tag_path / f"{sample_id}.json"
        with open(info_path, 'w', encoding='utf-8') as f:
            json.dump(sample_info, f, ensure_ascii=False, indent=2)

        return {
            "status": "success",
            "sample_id": sample_id,
            "sample_info": sample_info,
            "message": "示例图片上传成功"
        }

    except Exception as e:
        logger.error(f"上传示例图片失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 按标签查询示例图片 ====================
@router.get("/samples/tag/{tag_name}")
async def get_samples_by_tag(tag_name: str):
    """获取指定标签下的所有示例图片"""
    try:
        tag_path = os.path.join(settings.SAMPLES_ROOT, tag_name)

        if not os.path.exists(tag_path):
            return {
                "status": "success",
                "samples": [],
                "count": 0,
                "tag": tag_name
            }

        samples = []

        # 扫描所有JSON信息文件
        for filename in os.listdir(tag_path):
            if filename.endswith('.json') and not filename.startswith('.tag_info'):
                info_path = os.path.join(tag_path, filename)
                try:
                    with open(info_path, 'r', encoding='utf-8') as f:
                        sample_info = json.load(f)

                    # 构建完整的URL路径
                    sample_info["image_url"] = f"/samples/{tag_name}/{sample_info['filename']}"
                    sample_info["mask_url"] = f"/masks/{tag_name}/{sample_info['filename']}"

                    samples.append(sample_info)
                except Exception as e:
                    logger.error(f"读取样本信息失败 {info_path}: {str(e)}")
                    continue

        # 按创建时间排序
        samples.sort(key=lambda x: x.get("created_at", ""), reverse=True)

        return {
            "status": "success",
            "samples": samples,
            "count": len(samples),
            "tag": tag_name
        }
    except Exception as e:
        logger.error(f"获取标签样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 获取所有示例图片（支持标签过滤） ====================
@router.get("/samples")
async def get_all_samples(
        tag: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
):
    """获取所有示例图片（可选标签过滤）"""
    try:
        all_samples = []

        for root, dirs, files in os.walk(settings.SAMPLES_ROOT):
            # 跳过根目录
            if root == settings.SAMPLES_ROOT:
                continue

            # 提取标签名
            tag_name = os.path.relpath(root, settings.SAMPLES_ROOT)

            # 如果指定了标签，只处理该标签
            if tag and tag != tag_name:
                continue

            # 处理JSON信息文件
            for file in files:
                if file.endswith('.json') and not file.startswith('.tag_info'):
                    info_path = os.path.join(root, file)
                    try:
                        with open(info_path, 'r', encoding='utf-8') as f:
                            sample_info = json.load(f)

                        # 确保包含标签信息
                        sample_info["tag"] = tag_name
                        sample_info["image_url"] = f"/samples/{tag_name}/{sample_info.get('filename', '')}"
                        sample_info["mask_url"] = f"/masks/{tag_name}/{sample_info.get('filename', '')}"

                        all_samples.append(sample_info)
                    except Exception as e:
                        logger.error(f"读取样本信息失败 {info_path}: {str(e)}")
                        continue

        # 按创建时间排序
        all_samples.sort(key=lambda x: x.get("created_at", ""), reverse=True)

        # 分页
        paginated_samples = all_samples[skip:skip + limit]

        return {
            "status": "success",
            "samples": paginated_samples,
            "count": len(paginated_samples),
            "total": len(all_samples),
            "tag": tag
        }
    except Exception as e:
        logger.error(f"获取所有样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 获取单个样本详情 ====================
@router.get("/samples/{sample_id}")
async def get_sample_detail(sample_id: str):
    """获取单个样本的详细信息"""
    try:
        # 查找样本信息文件
        sample_info = None
        sample_path = None

        for root, dirs, files in os.walk(settings.SAMPLES_ROOT):
            for file in files:
                if file == f"{sample_id}.json":
                    sample_path = os.path.join(root, file)
                    with open(sample_path, 'r', encoding='utf-8') as f:
                        sample_info = json.load(f)
                    break
            if sample_info:
                break

        if not sample_info:
            raise HTTPException(status_code=404, detail="样本不存在")

        # 构建完整的URL路径
        tag_name = sample_info.get("tag", "")
        if tag_name:
            sample_info["image_url"] = f"/examples/{tag_name}/{sample_info['filename']}"
            sample_info["mask_url"] = f"/masks/{tag_name}/{sample_info['filename']}"

        return {
            "status": "success",
            "sample": sample_info
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取样本详情失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 获取样本标签 ====================
@router.get("/samples/{sample_id}/tag")
async def get_sample_tag(sample_id: str):
    """获取样本的标签"""
    try:
        # 查找样本信息文件
        for root, dirs, files in os.walk(settings.SAMPLES_ROOT):
            for file in files:
                if file == f"{sample_id}.json":
                    info_path = os.path.join(root, file)
                    with open(info_path, 'r', encoding='utf-8') as f:
                        sample_info = json.load(f)

                    return {
                        "status": "success",
                        "sample_id": sample_id,
                        "tag": sample_info.get("tag", "")
                    }

        raise HTTPException(status_code=404, detail="样本不存在")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取样本标签失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 删除示例图片 ====================
@router.delete("/samples/{sample_id}")
async def delete_sample(sample_id: str):
    """删除示例图片（删除原图、掩码和信息文件）"""
    try:
        # 查找样本信息文件
        sample_info = None
        sample_path = None
        sample_root = None

        for root, dirs, files in os.walk(settings.SAMPLES_ROOT):
            for file in files:
                if file == f"{sample_id}.json":
                    sample_path = os.path.join(root, file)
                    sample_root = root
                    with open(sample_path, 'r', encoding='utf-8') as f:
                        sample_info = json.load(f)
                    break
            if sample_info:
                break

        if not sample_info:
            raise HTTPException(status_code=404, detail="样本不存在")

        tag_name = sample_info.get("tag", "")

        # 删除原图
        if "filename" in sample_info:
            image_path = os.path.join(sample_root, sample_info["filename"])
            if os.path.exists(image_path):
                os.remove(image_path)

        # 删除掩码
        if tag_name and "filename" in sample_info:
            mask_root = os.path.join(settings.MASKS_ROOT, tag_name)
            mask_path = os.path.join(mask_root, sample_info["filename"])
            if os.path.exists(mask_path):
                os.remove(mask_path)

        # 删除信息文件
        if sample_path and os.path.exists(sample_path):
            os.remove(sample_path)

        # 更新标签信息
        if tag_name:
            tag_info_path = os.path.join(settings.SAMPLES_ROOT, tag_name, ".tag_info.json")
            if os.path.exists(tag_info_path):
                with open(tag_info_path, 'r', encoding='utf-8') as f:
                    tag_info = json.load(f)

                tag_info["samples_count"] = max(0, tag_info.get("samples_count", 1) - 1)
                tag_info["updated_at"] = datetime.now().isoformat()

                with open(tag_info_path, 'w', encoding='utf-8') as f:
                    json.dump(tag_info, f, ensure_ascii=False, indent=2)

        logger.info(f"删除样本成功: {sample_id}")
        return {
            "status": "success",
            "message": "样本删除成功"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除样本失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))