

# -*- coding: utf-8 -*-
"""
路由模块包
"""

# 在 __init__.py 中添加父目录到 sys.path
import sys
from pathlib import Path

parent_dir = Path(__file__).parent.parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

from . import health, search, samples

__all__ = ['health', 'search', 'samples']

