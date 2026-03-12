# -*- coding: utf-8 -*-
"""
特征提取器模块
"""

import torch
import numpy as np
from PIL import Image
from transformers import AutoImageProcessor, AutoModel

from utils import normalize_features


class DINOv3FeatureExtractor:
    """DINOv3特征提取器"""

    def __init__(self, model_path: str, device: str = "cuda:0"):
        self.device = device
        self.processor = AutoImageProcessor.from_pretrained(model_path)
        self.model = AutoModel.from_pretrained(
            model_path,
            use_safetensors=True,
            device_map='auto' if device == "cuda:0" else None
        )
        if device != "cuda:0" and not device.startswith("cuda"):
            self.model = self.model.to(device)
        self.model.eval()
        self.num_regs = getattr(self.model.config, 'num_register_tokens', 0)

    def extract_features(self, image: Image.Image, mask: Image.Image = None) -> np.ndarray:
        """提取图像特征"""
        inputs = self.processor(images=image, return_tensors="pt").to(self.model.device)
        with torch.no_grad():
            outputs = self.model(**inputs)

        patch_features = outputs.last_hidden_state[0, 1 + self.num_regs:, :]

        if mask is None:
            max_pool, _ = torch.max(patch_features, dim=0)
            return normalize_features(max_pool.cpu().numpy())
        else:
            mask_resized = mask.resize((14, 14), Image.Resampling.NEAREST)
            mask_array = np.array(mask_resized) > 0
            if not np.any(mask_array):
                max_pool, _ = torch.max(patch_features, dim=0)
                return normalize_features(max_pool.cpu().numpy())

            mask_flat = torch.from_numpy(mask_array.flatten()).bool().to(patch_features.device)
            region_features = patch_features[mask_flat]

            if region_features.shape[0] == 0:
                max_pool, _ = torch.max(patch_features, dim=0)
                return normalize_features(max_pool.cpu().numpy())

            max_pool, _ = torch.max(region_features, dim=0)
            return normalize_features(max_pool.cpu().numpy())