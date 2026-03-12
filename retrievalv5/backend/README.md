# 后端模块化说明

## 目录结构

```
backend/
├── __init__.py           # 模块包初始化
├── config.py             # 配置管理
├── database.py           # 数据库管理
├── models.py             # Pydantic 数据模型
├── utils.py              # 工具函数
├── extractors.py         # 特征提取器 (DINOv3)
├── image_tools.py        # 图像处理工具
├── sample_manager.py     # 样本管理
├── aggregation.py        # 目标聚合
├── main.py               # FastAPI 应用入口
└── routers/              # API 路由
    ├── __init__.py
    ├── health.py         # 健康检查
    ├── search.py         # 搜索相关接口
    └── samples.py        # 样本和标签管理接口
```

## 启动方式

### 开发模式
```bash
python backend/main.py
```

### 生产模式
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 5007 --workers 1
```

## 模块说明

### config.py
- 使用 `pydantic-settings` 管理配置
- 从 `.env` 文件读取环境变量
- 定义全局配置常量

### database.py
- 数据库连接池管理
- 向量检索功能
- 特征差检索功能

### extractors.py
- DINOv3 特征提取器
- 支持掩码的特征提取

### image_tools.py
- 缩略图生成器
- 多边形截图生成器
- 瓦片加载工具

### aggregation.py
- 目标空间聚合
- 并查集实现
- GeoJSON 格式转换

### routers/
- `health.py`: 健康检查、可用年份查询
- `search.py`: 搜索、变化检测、特征提取
- `samples.py`: 样本上传、标签管理

## 依赖安装

```bash
pip install fastapi uvicorn torch transformers asyncpg shapely pillow pydantic-settings
```

## 环境变量

请确保项目根目录下有 `.env` 文件，包含以下配置：

```ini
# 数据库
PG_HOST=127.0.0.1
PG_PORT=5432
PG_DB=searchV5
PG_USER=postgres
PG_PASSWORD=123456

# 业务配置
DATASET_ID=0
MODEL_ID=0
ACTIVE_TABLE=tile_patch_xiaoshan

# 路径
MODEL_CKPT_PATH=./dinov3-vitl16-pretrain-sat493m
TILES_ROOT=./tiles
SAMPLES_ROOT=./examples
MASKS_ROOT=./masks

# 系统
DEVICE=cuda:0
DEBUG=True
PORT=5007

# 天地图
TDT_BROWSER_TK=your_token
TDT_SERVER_TK=your_token
```

## API 文档

启动服务后访问：
- Swagger UI: http://localhost:5007/docs
- ReDoc: http://localhost:5007/redoc

## 迁移说明

旧版 `main.py` 已被模块化重构，功能完全保持不变。如需使用旧版本，可以直接运行项目根目录下的 `main.py`。