# AGENTS.md - 天瞳-AI全域图侦系统

## 项目概述

**天瞳-AI全域图侦系统**是一个基于深度学习的遥感影像智能检索与分析平台，核心功能包括：

- **以图搜图**：通过绘制ROI区域或上传示例图片，在遥感影像库中搜索相似图斑
- **跨时相变化检测**：对比不同年份的遥感影像，自动检测地表变化区域
- **示例图片管理**：支持标签管理、图片上传、ROI区域绘制等功能

### 技术栈

| 层级 | 技术选型 |
|------|----------|
| **前端** | HTML5 + CSS3 + JavaScript (原生) + Leaflet.js 地图库 |
| **后端** | Python 3.x + FastAPI |
| **深度学习** | PyTorch + Transformers (DINOv3 视觉模型) |
| **数据库** | PostgreSQL + pgvector (向量检索) |
| **地图服务** | 天地图 API + 本地瓦片服务 |

---

## 项目结构

```
retrievalv5/
├── index.html                 # 主页面入口
├── main.py                    # FastAPI 后端主程序
├── client.py                  # 后端接口测试客户端
├── .env                       # 环境变量配置
├── readme.md                  # 项目说明文档
│
├── css/                       # 样式文件
│   ├── style.css              # 主样式
│   ├── style4CD.css           # 变化检测样式
│   ├── style4modi.css         # 修改样式
│   └── style4SelectEx.css     # 示例选择器样式
│
├── js/                        # 前端 JavaScript 模块
│   ├── config.js              # 全局配置常量
│   ├── main.js                # 主入口，初始化各模块
│   ├── map.js                 # 地图初始化与图层管理
│   ├── search.js              # 搜索功能（以图搜图、变化检测）
│   ├── ui.js                  # UI交互（抽屉、面板、通知等）
│   ├── drawing.js             # 绘制功能（ROI绘制）
│   ├── sample-management.js   # 示例图片管理
│   ├── sample-select.js       # 示例图片选择器
│   └── utils.js               # 工具函数
│
├── examples/                  # 示例图片存储（按标签分文件夹）
│   ├── 林地/                  # 每个标签一个文件夹
│   ├── 种植地/                # 包含 .png 图片和 .json 元数据
│   └── ...                    # 以及 .tag_info.json 标签信息
│
├── masks/                     # 示例图片对应的ROI掩码
│   └── [标签]/                # 结构与 examples 对应
│
├── tiles/                     # 遥感影像瓦片数据
│   ├── 2023/                  # 按年份组织
│   │   └── {z}/{x}/{y}.png    # 标准瓦片结构
│   └── 2025/
│
└── dinov3-vitl16-pretrain-sat493m/   # DINOv3 预训练模型
    ├── config.json
    ├── model.safetensors
    └── ...
```

---

## 环境配置

### 环境变量 (.env)

```ini
# 数据库配置
PG_HOST=172.27.48.1
PG_PORT=5433
PG_DB=search
PG_USER=postgres
PG_PASSWORD=your_password

# 业务配置
DATASET_ID=0
MODEL_ID=0
ACTIVE_TABLE=tile_patch_xiaoshan

# 模型与数据路径
MODEL_CKPT_PATH=./dinov3-vitl16-pretrain-sat493m
TILES_ROOT=./tiles

# 系统配置
DEVICE=cuda:0
DEBUG=True
PORT=5007

# 天地图 API 密钥
TDT_BROWSER_TK=your_browser_token
TDT_SERVER_TK=your_server_token
```

### 依赖安装

```bash
# Python 后端依赖
pip install fastapi uvicorn torch transformers asyncpg shapely pillow pydantic-settings

# 或使用 requirements.txt（如果存在）
pip install -r requirements.txt
```

---

## 运行与构建

### 启动后端服务

```bash
# 开发模式
python main.py

# 或使用 uvicorn
uvicorn main:app --host 0.0.0.0 --port 5007 --reload
```

后端启动后将监听 `http://localhost:5007`

### 启动前端

前端为静态文件，可通过以下方式访问：

```bash
# 方式1：直接用后端服务访问
# 后端会自动托管静态文件，访问 http://localhost:5007/

# 方式2：使用其他静态服务器
npx serve .
# 或
python -m http.server 8080
```

### 测试后端接口

```bash
# 运行测试客户端
python client.py

# 指定服务地址
python client.py --url http://localhost:5007

# 测试特定接口
python client.py --test health
python client.py --test years
```

---

## 核心API接口

### 健康检查

```
GET /health
```

返回服务状态、数据库连接、模型加载、特征库数量等信息。

### 获取可用年份

```
GET /available_years
```

返回数据库和文件系统中可用的影像年份列表。

### 以图搜图

```
POST /search_top_n_target
Content-Type: application/json

{
  "features": [0.1, 0.2, ...],  // 1024维特征向量
  "top_n": 100,
  "year": 2025
}
```

### 变化检测

```
POST /change_detection_by_samples
Content-Type: application/json

{
  "sample_id1": "before_sample_id",
  "sample_id2": "after_sample_id",
  "year1": 2023,
  "year2": 2025,
  "top_n": 100,
  "min_similarity": 0.3
}
```

### 示例图片管理

```
GET    /samples                 # 获取所有示例
GET    /samples/tag/{tag}       # 按标签获取示例
POST   /samples/upload          # 上传示例图片
DELETE /samples/{sample_id}     # 删除示例

GET    /tags                    # 获取所有标签
POST   /tags                    # 创建标签
DELETE /tags/{tag_name}         # 删除标签
```

---

## 开发约定

### 前端代码规范

1. **模块化**：每个 JS 文件负责单一功能模块
2. **全局变量**：`map`, `Config`, `drawnItems` 等核心变量挂载在 `window` 对象
3. **事件绑定**：在各自的模块中绑定，避免全局污染
4. **异步处理**：使用 `async/await` 处理 API 调用

### 后端代码规范

1. **配置管理**：使用 `pydantic-settings` 的 `Settings` 类统一管理配置
2. **数据库操作**：使用 `asyncpg` 连接池，支持高并发
3. **向量检索**：使用 PostgreSQL 的 `pgvector` 扩展和 HNSW 索引
4. **错误处理**：统一使用 `HTTPException` 返回错误信息

### 数据库表结构

主要使用 `tile_patch_xiaoshan` 表存储影像图斑特征：

```sql
CREATE TABLE tile_patch_xiaoshan (
    id SERIAL PRIMARY KEY,
    dataset_id INTEGER,
    model_id INTEGER,
    z INTEGER,           -- 缩放级别
    x INTEGER,           -- 瓦片列号
    y INTEGER,           -- 瓦片行号
    patch_id INTEGER,    -- 图斑ID
    data_year INTEGER,   -- 数据年份
    data_month INTEGER,  -- 数据月份
    embedding vector(1024)  -- 特征向量
);
```

---

## 功能模块说明

### 1. 地图模块 (map.js)

- 初始化 Leaflet 地图
- 加载遥感影像瓦片（支持多年份切换）
- 叠加天地图注记图层
- 支持行政边界 WMS 图层

### 2. 搜索模块 (search.js)

- **以图搜图**：绘制 ROI → 生成截图 → 提取特征 → 向量检索 → 空间聚合
- **变化检测**：前后时相对比 → 特征差计算 → 变化区域定位

### 3. 示例管理模块 (sample-management.js)

- 标签 CRUD 操作
- 图片上传与 ROI 绘制
- 掩码自动生成

### 4. 绘制模块 (drawing.js)

- 多边形 ROI 绘制
- 支持撤销、取消操作
- 坐标转换与边界计算

---

## 常见问题排查

### 后端无法启动

1. 检查 `.env` 配置是否正确
2. 确认 PostgreSQL 数据库已启动且可连接
3. 确认 CUDA 环境配置正确（如使用 GPU）
4. 检查模型文件是否完整

### 前端地图无法显示

1. 检查后端服务是否正常运行
2. 确认瓦片数据路径配置正确
3. 检查浏览器控制台是否有跨域错误

### 搜索无结果

1. 确认数据库中有对应年份的特征数据
2. 检查 `ACTIVE_TABLE` 配置是否正确
3. 查看后端日志确认检索过程

### 变化检测失败

1. 确认前后时相年份都有对应的特征差表
2. 检查示例图片是否正确上传
3. 确认 ROI 区域绘制完整

---

## 扩展开发指南

### 添加新的影像年份

1. 在 `tiles/` 目录下创建对应年份文件夹
2. 准备瓦片数据（标准 XYZ 结构）
3. 运行特征提取脚本入库
4. 前端会自动识别新年份

### 添加新的搜索模式

1. 在 `index.html` 添加 UI 控件
2. 在 `search.js` 实现搜索逻辑
3. 在 `main.py` 添加对应 API 接口

### 自定义特征模型

1. 替换 `dinov3-vitl16-pretrain-sat493m/` 目录下的模型文件
2. 修改 `main.py` 中的特征维度配置（`FEATURE_DIM`）
3. 重新提取并入库特征数据

---

## 联系与支持

如有问题，请参考 `readme.md` 或联系项目维护人员。
