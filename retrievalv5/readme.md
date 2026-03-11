一、项目结构
project/
├── index.html          # 主HTML文件，包含页面结构和外部资源引用
├── css/
│   └── style.css
│   └── style4CD.css
│   └── style4modi.css
│   └── style4SelectEX.css
├── js/
│   ├── config.js      # 配置常量
│   ├── utils.js       # 工具函数
│   ├── map.js         # 地图初始化及相关功能
│   ├── ui.js          # 用户界面交互（抽屉、面板、模态框等）
│   ├── drawing.js     # 绘制功能（地图绘制和示例图绘制）
│   ├── search.js      # 搜索功能（单时相和变化检测）
│   ├── sample-management.js     # 示例图片管理维护
│   ├── sample-select.js     # 搜索输入示例图片的选择器
│   └── main.js        # 主入口，初始化各个模块
├── examples/          # 示例图片存储
│   ├── 林地            # 多张林地图片可存储于“林地”文件夹，以林地为一级标签，每张图片的文件名可个性化，如：稀疏林、稠密林、林中含裸地等。
│   └── 种植地          #
│   └── ...
├── masks/             # 示例图片的roi对应的掩码，子文件夹名和文件名与examples相同。该掩码为单通道黑白图像。
│   ├── 林地            #
│   └── 种植地          #
│   └── ...
├── dinov3-vitl16-pretrain-sat493m/             # dinov3的预训练模型
├── tiles/             # dinov3的预训练模型
│   ├── 2023           # 2023年的瓦片
│   └── 2025           # 2025年的瓦片
│   └── ...            # 其他年份的瓦片
├── .env               # 环境变量
├── main.py            # 后端API主程序
└── readme             # 项目说明

二、向量数据库构建
1、数据表创建
（1）tile_patch_xiaoshan.sql  #tile_patch_xiaoshan表创建，以图搜图向量数据库；
（2）tile_patch_emdiff_2023_2025.sql   #tile_patch_emdiff_2023_2025表创建，变化检测向量数据库
diff列为2023和2025的特征向量之差。
2、特征提取及入库脚本
（1）dataprocessing4search.py--------->tile_patch_xiaoshan.sql
（2）dataprocessing4CD.py--------->tile_patch_emdiff_2023_2025.sql
注意源数据目录结构参考tiles/

