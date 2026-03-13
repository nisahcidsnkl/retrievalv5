// screenshot.js - 截图功能交互逻辑

// 场景数据
const sceneData = {
  "草地生态破坏": [
    "采矿超范围堆放",
    "采土、采砂、采石",
    "固废堆放",
    "开垦草地",
    "其他占用草地",
    "违规放牧",
    "开展经营性旅游活动"
  ],
  "林地保护场景": [
    "采土采石",
    "公益林保护",
    "固废堆放",
    "开垦",
    "林地保护区",
    "修建永久性建筑",
    "工程施工",
    "违建"
  ],
  "铁塔": [
    "采土、采矿、采砂",
    "复合子场景",
    "工程施工",
    "固废堆放",
    "建筑物侵占",
    "占用林草",
    "露营地"
  ],
  "林耕保护场景": [
    "固废堆放"
  ],
  "交通安全保护场景": [
    "乱堆",
    "乱建"
  ],
  "传统村落疑似风貌变化": [],
  "临时用地": [
    "采土、采矿、采砂",
    "固废堆放",
    "超期"
  ],
  "建设管制区": [],
  "水库生态保护场景": [
    "乱堆",
    "河道违建",
    "河道占用",
    "护岸林砍伐",
    "停靠船舶",
    "周边养殖",
    "河道采砂",
    "非法码头"
  ],
  "耕地保护场景": [
    "“两区”保护",
    "高标准农田",
    "开垦鱼塘",
    "一般农田",
    "永久基本农田",
    "乱建",
    "固废堆积"
  ],
  "湿地生态保护场景": [
    "占用湿地"
  ],
  "森林防火道": [
    "非合理施工",
    "合理施工",
    "未施工"
  ],
  "河湖“四乱”": [
    "乱建",
    "河道占用",
    "浮水植物",
    "河道围垦",
    "非法码头",
    "非法砂石加工点",
    "乱堆",
    "废弃船舶",
    "湖泊围垦",
    "水上浮动设施"
  ],
  "地质灾害防范场景": [],
  "闲置土地": [],
  "违规采矿": [],
  "扬尘污染": [],
  "固废堆放": [],
  "其他":[]
}

// 截图数据
let screenshotImages = {
  image1: null,
  image2: null
};

// 年份数据
let screenshotYears = [];

// 截图矩形框绘制相关变量
let isDrawingScreenshotRect = false;
let screenshotRectStartLatLng = null;
let screenshotRectLayer = null;
let screenshotRectBox = null;

/**
 * 开始绘制截图矩形框
 */
function startScreenshotRectDrawing() {
  if (isDrawingScreenshotRect) {
    cancelScreenshotRectDrawing();
    return;
  }

  // 清除之前的矩形框
  if (screenshotRectLayer && map.hasLayer(screenshotRectLayer)) {
    map.removeLayer(screenshotRectLayer);
  }
  if (screenshotRectBox && map.hasLayer(screenshotRectBox)) {
    map.removeLayer(screenshotRectBox);
  }

  screenshotRectStartLatLng = null;
  screenshotRectLayer = null;
  screenshotRectBox = null;

  isDrawingScreenshotRect = true;

  // 禁用地图的双击缩放
  map.doubleClickZoom.disable();
  map.dragging.disable();

  // 更改鼠标样式
  map.getContainer().style.cursor = 'crosshair';

  showNotification('请按住鼠标左键拖动绘制矩形框（最小分辨率128×128像素）', 'info');
}

/**
 * 鼠标按下事件
 */
function onScreenshotRectMouseDown(e) {
  if (!isDrawingScreenshotRect) return;

  screenshotRectStartLatLng = e.latlng;
}

/**
 * 鼠标移动事件
 */
function onScreenshotRectMouseMove(e) {
  if (!isDrawingScreenshotRect || !screenshotRectStartLatLng) return;

  // 移除旧的矩形框
  if (screenshotRectBox && map.hasLayer(screenshotRectBox)) {
    map.removeLayer(screenshotRectBox);
  }

  // 计算矩形框的边界
  const bounds = L.latLngBounds(screenshotRectStartLatLng, e.latlng);

  // 绘制临时矩形框
  screenshotRectBox = L.rectangle(bounds, {
    color: '#17a2b8',
    weight: 3,
    fillColor: '#17a2b8',
    fillOpacity: 0.15,
    dashArray: '10 10'
  }).addTo(map);
}

/**
 * 鼠标松开事件
 */
function onScreenshotRectMouseUp(e) {
  if (!isDrawingScreenshotRect || !screenshotRectStartLatLng) return;

  isDrawingScreenshotRect = false;
  map.doubleClickZoom.enable();
  map.dragging.enable();
  map.getContainer().style.cursor = '';

  // 计算矩形框的边界
  const bounds = L.latLngBounds(screenshotRectStartLatLng, e.latlng);

  // 移除临时矩形框
  if (screenshotRectBox && map.hasLayer(screenshotRectBox)) {
    map.removeLayer(screenshotRectBox);
    screenshotRectBox = null;
  }

  // 验证矩形框大小
  if (!validateScreenshotRectSize(bounds)) {
    showNotification('矩形框分辨率不能小于128×128像素，请重新绘制', 'error');
    screenshotRectStartLatLng = null;
    return;
  }

  // 绘制最终的矩形框
  screenshotRectLayer = L.rectangle(bounds, {
    color: '#17a2b8',
    weight: 3,
    fillColor: '#17a2b8',
    fillOpacity: 0.2
  }).addTo(map);

  // 计算矩形框的像素尺寸
  const pixelSize = calculateRectPixelSize(bounds);

  const center = bounds.getCenter();
  showNotification(`矩形框绘制完成！尺寸: ${pixelSize.width.toFixed(0)}×${pixelSize.height.toFixed(0)}像素`, 'success');

  // 调用处理函数，截取两个时相的图像
  processScreenshotRect(bounds);
}

/**
 * 验证矩形框大小
 */
function validateScreenshotRectSize(bounds) {
  const pixelSize = calculateRectPixelSize(bounds);
  return pixelSize.width >= 128 && pixelSize.height >= 128;
}

/**
 * 计算矩形框的像素尺寸
 */
function calculateRectPixelSize(bounds) {
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();

  // 获取地图容器尺寸
  const mapContainer = map.getContainer();
  const containerWidth = mapContainer.offsetWidth;
  const containerHeight = mapContainer.offsetHeight;

  // 获取地图当前的边界
  const mapBounds = map.getBounds();

  // 计算缩放因子
  const mapWidth = mapBounds.getEast() - mapBounds.getWest();
  const mapHeight = mapBounds.getNorth() - mapBounds.getSouth();

  const scaleX = containerWidth / mapWidth;
  const scaleY = containerHeight / mapHeight;

  // 计算矩形框的经纬度尺寸
  const rectWidth = northEast.lng - southWest.lng;
  const rectHeight = northEast.lat - southWest.lat;

  // 计算像素尺寸
  const pixelWidth = rectWidth * scaleX;
  const pixelHeight = rectHeight * scaleY;

  return {
    width: Math.abs(pixelWidth),
    height: Math.abs(pixelHeight)
  };
}

/**
 * 取消截图绘制
 */
function cancelScreenshotRectDrawing() {
  isDrawingScreenshotRect = false;
  screenshotRectStartLatLng = null;

  if (screenshotRectLayer && map.hasLayer(screenshotRectLayer)) {
    map.removeLayer(screenshotRectLayer);
    screenshotRectLayer = null;
  }

  if (screenshotRectBox && map.hasLayer(screenshotRectBox)) {
    map.removeLayer(screenshotRectBox);
    screenshotRectBox = null;
  }

  map.doubleClickZoom.enable();
  map.dragging.enable();
  map.getContainer().style.cursor = '';

  showNotification('已取消截图绘制', 'info');
}

/**
 * 清除截图矩形框
 */
function clearScreenshotRect() {
  if (screenshotRectLayer && map.hasLayer(screenshotRectLayer)) {
    map.removeLayer(screenshotRectLayer);
    screenshotRectLayer = null;
  }

  showNotification('已清除截图矩形框', 'info');
}

/**
 * 初始化截图功能
 */
function initScreenshotFeature() {
  console.log('初始化截图功能...');

  // 绑定截图按钮事件
  const screenshotBtn = document.getElementById('screenshotBtn');
  if (screenshotBtn) {
    screenshotBtn.addEventListener('click', toggleScreenshotDrawing);
  }

  // 绑定地图事件
  map.on('mousedown', onScreenshotRectMouseDown);
  map.on('mousemove', onScreenshotRectMouseMove);
  map.on('mouseup', onScreenshotRectMouseUp);

  // 绑定弹窗事件
  initScreenshotModalEvents();

  console.log('截图功能初始化完成');
}

/**
 * 切换截图绘制状态
 */
function toggleScreenshotDrawing() {
  if (isDrawingScreenshotRect) {
    cancelScreenshotRectDrawing();
  } else {
    startScreenshotRectDrawing();
  }
}

/**
 * 初始化弹窗事件
 */
function initScreenshotModalEvents() {
  // 关闭按钮
  const closeBtn = document.getElementById('screenshotModalCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeScreenshotModal);
  }

  // 取消按钮
  const cancelBtn = document.getElementById('cancelScreenshotBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeScreenshotModal);
  }

  // 保存按钮
  const saveBtn = document.getElementById('saveScreenshotBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveScreenshot);
  }

  // 初始化主场景下拉框
  const mainSceneSelect = document.getElementById('mainSceneSelect');
  if (mainSceneSelect) {
    mainSceneSelect.innerHTML = '<option value="">请选择主场景</option>';
    for (const mainScene in sceneData) {
      const option = document.createElement('option');
      option.value = mainScene;
      option.textContent = mainScene;
      mainSceneSelect.appendChild(option);
    }
    // 绑定改变事件
    mainSceneSelect.addEventListener('change', onMainSceneChange);
  }

  // 子场景下拉框联动
  const subSceneSelect = document.getElementById('subSceneSelect');
  if (subSceneSelect) {
    subSceneSelect.addEventListener('change', onSubSceneChange);
  }

  // 点击弹窗外部关闭
  const modal = document.getElementById('screenshotModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeScreenshotModal();
      }
    });
  }
}

/**
 * 主场景改变事件
 */
function onMainSceneChange() {
  const mainScene = document.getElementById('mainSceneSelect').value;
  const subSceneSelect = document.getElementById('subSceneSelect');

  // 清空子场景选项
  subSceneSelect.innerHTML = '';

  if (mainScene && sceneData[mainScene]) {
    subSceneSelect.disabled = false;
    sceneData[mainScene].forEach(subScene => {
      const option = document.createElement('option');
      option.value = subScene;
      option.textContent = subScene;
      subSceneSelect.appendChild(option);
    });
  } else {
    subSceneSelect.disabled = true;
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '请先选择主场景';
    subSceneSelect.appendChild(option);
  }

  updateDescriptionText();
}

/**
 * 子场景改变事件
 */
function onSubSceneChange() {
  updateDescriptionText();
}

/**
 * 更新描述文本
 */
function updateDescriptionText() {
  const mainScene = document.getElementById('mainSceneSelect').value;
  const subScene = document.getElementById('subSceneSelect').value;
  const descriptionTextarea = document.getElementById('screenshotDescription');

  if (mainScene && subScene) {
    descriptionTextarea.value = `该线索属于${mainScene}${subScene}`;
  } else {
    descriptionTextarea.value = '';
  }
}

/**
 * 处理截图矩形框
 */
async function processScreenshotRect(bounds) {
  try {
    showNotification('正在生成截图，请稍候...', 'info');

    // 获取两个时相的年份
    const years = Config.availableYears.sort((a, b) => a - b);
    if (years.length < 2) {
      showNotification('至少需要两个年份的数据才能进行截图对比', 'error');
      return;
    }

    // 取两个年份（最早的和最新的）
    const year1 = years[0];
    const year2 = years[years.length - 1];

    screenshotYears = [year1, year2];

    // 准备请求数据
    const boundsObj = {
      min_lat: bounds.getSouth(),
      min_lng: bounds.getWest(),
      max_lat: bounds.getNorth(),
      max_lng: bounds.getEast()
    };

    const requestPayload = {
      bounds: boundsObj,
      zoom: map.getZoom(),
      years: screenshotYears
    };

    console.log('发送截图请求:', requestPayload);

    // 调用后端接口
    const response = await fetch(`${Config.serverUrl}/screenshot_rect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status === 'success') {
      // 更新截图数据
      const images = data.images;
      screenshotImages.image1 = images[String(year1)];
      screenshotImages.image2 = images[String(year2)];

      // 更新弹窗UI
      updateScreenshotModalUI(year1, year2);

      // 显示弹窗
      openScreenshotModal();

      showNotification('截图生成成功！', 'success');
    } else {
      throw new Error('截图生成失败');
    }

  } catch (error) {
    console.error('处理截图矩形框失败:', error);
    showNotification(`截图生成失败: ${error.message}`, 'error');
  }
}

/**
 * 更新截图弹窗UI
 */
function updateScreenshotModalUI(year1, year2) {
  // 更新年份标签
  document.getElementById('screenshotImage1Label').textContent = `${year1}年`;
  document.getElementById('screenshotImage2Label').textContent = `${year2}年`;

  // 更新图像
  const image1El = document.getElementById('screenshotImage1');
  const image2El = document.getElementById('screenshotImage2');

  if (screenshotImages.image1) {
    image1El.src = `data:image/png;base64,${screenshotImages.image1}`;
  } else {
    image1El.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  }

  if (screenshotImages.image2) {
    image2El.src = `data:image/png;base64,${screenshotImages.image2}`;
  } else {
    image2El.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  }

  // 重置下拉框和描述文本
  document.getElementById('mainSceneSelect').value = '';
  document.getElementById('subSceneSelect').innerHTML = '<option value="">请先选择主场景</option>';
  document.getElementById('subSceneSelect').disabled = true;
  document.getElementById('screenshotDescription').value = '';
}

/**
 * 打开截图弹窗
 */
function openScreenshotModal() {
  const modal = document.getElementById('screenshotModal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

/**
 * 关闭截图弹窗
 */
function closeScreenshotModal() {
  const modal = document.getElementById('screenshotModal');
  if (modal) {
    modal.style.display = 'none';
  }

  // 清除地图上的矩形框
  clearScreenshotRect();
}

/**
 * 保存截图
 */
async function saveScreenshot() {
  try {
    // 验证输入
    const mainScene = document.getElementById('mainSceneSelect').value;
    const subScene = document.getElementById('subSceneSelect').value;
    const description = document.getElementById('screenshotDescription').value;

    if (!mainScene) {
      showNotification('请选择主场景', 'error');
      return;
    }

    if (!subScene) {
      showNotification('请选择子场景', 'error');
      return;
    }

    if (!description.trim()) {
      showNotification('请输入描述文本', 'error');
      return;
    }

    // 准备保存数据
    const savePayload = {
      main_scene: mainScene,
      sub_scene: subScene,
      description: description,
      images: {}
    };

    // 添加图像数据
    if (screenshotYears.length >= 1 && screenshotImages.image1) {
      savePayload.images[String(screenshotYears[0])] = screenshotImages.image1;
    }
    if (screenshotYears.length >= 2 && screenshotImages.image2) {
      savePayload.images[String(screenshotYears[1])] = screenshotImages.image2;
    }

    console.log('保存截图:', savePayload);

    // 调用后端保存接口
    const response = await fetch(`${Config.serverUrl}/save_screenshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(savePayload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status === 'success') {
      showNotification(`截图保存成功！保存路径: ${data.save_path}`, 'success');
      closeScreenshotModal();
    } else {
      throw new Error('保存失败');
    }

  } catch (error) {
    console.error('保存截图失败:', error);
    showNotification(`保存截图失败: ${error.message}`, 'error');
  }
}

// 截图功能已在main.js中初始化