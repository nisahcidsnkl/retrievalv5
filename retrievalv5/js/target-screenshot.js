// target-screenshot.js - 目标截图功能

// 全局变量
let targetScreenshotImages = {
  image1: null,
  image2: null
};
let targetScreenshotYears = [];

/**
 * 保存目标截图
 * @param {number} targetIndex - 目标索引
 * @param {object} target - 目标对象
 * @param {number} beforeYear - 前时相年份
 * @param {number} afterYear - 后时相年份
 */
async function saveTargetScreenshot(targetIndex, target, beforeYear, afterYear) {
  try {
    showNotification('正在生成目标截图...', 'info');

    // 获取目标的geometry
    const geometry = target.geometry || target.bounds;
    
    if (!geometry) {
      showNotification('目标几何信息不完整', 'error');
      return;
    }

    // 计算最小矩形框
    const bounds = calculateBoundingBox(geometry);
    
    // 向外拓展50个像素点
    const padding = 50;
    const zoom = 18; // 使用固定的缩放级别
    
    // 将经纬度转换为像素坐标
    const minPixel = latlngToPixel(bounds.min_lat, bounds.min_lng, zoom);
    const maxPixel = latlngToPixel(bounds.max_lat, bounds.max_lng, zoom);
    
    // 拓展像素坐标
    const paddedMinPixel = {
      x: minPixel.x - padding,
      y: minPixel.y - padding
    };
    const paddedMaxPixel = {
      x: maxPixel.x + padding,
      y: maxPixel.y + padding
    };
    
    // 将拓展后的像素坐标转换回经纬度
    const paddedBounds = {
      min_lat: pixelToLatLng(paddedMinPixel.x, paddedMinPixel.y, zoom).lat,
      min_lng: pixelToLatLng(paddedMinPixel.x, paddedMinPixel.y, zoom).lng,
      max_lat: pixelToLatLng(paddedMaxPixel.x, paddedMaxPixel.y, zoom).lat,
      max_lng: pixelToLatLng(paddedMaxPixel.x, paddedMaxPixel.y, zoom).lng
    };

    // 准备请求数据
    const payload = {
      bounds: paddedBounds,
      zoom: zoom,
      years: [beforeYear, afterYear]
    };

    console.log('发送目标截图请求:', payload);

    // 调用后端截图接口
    const response = await fetch(`${Config.serverUrl}/screenshot_rect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status === 'success') {
      // 更新截图数据
      const images = data.images;
      targetScreenshotImages.image1 = images[String(beforeYear)];
      targetScreenshotImages.image2 = images[String(afterYear)];
      targetScreenshotYears = [beforeYear, afterYear];

      // 更新弹窗UI
      updateTargetScreenshotModalUI(beforeYear, afterYear);

      // 显示弹窗
      openScreenshotModal();

      showNotification('目标截图生成成功！', 'success');
    } else {
      throw new Error('截图生成失败');
    }

  } catch (error) {
    console.error('保存目标截图失败:', error);
    showNotification(`保存目标截图失败: ${error.message}`, 'error');
  }
}

/**
 * 计算边界框
 * @param {object} geometry - 几何信息
 * @returns {object} 边界框 {min_lat, min_lng, max_lat, max_lng}
 */
function calculateBoundingBox(geometry) {
  if (geometry && geometry.type === 'Polygon' && geometry.coordinates) {
    const coords = geometry.coordinates[0]; // 获取外环坐标
    const lats = coords.map(c => c[1]);
    const lngs = coords.map(c => c[0]);
    
    return {
      min_lat: Math.min(...lats),
      max_lat: Math.max(...lats),
      min_lng: Math.min(...lngs),
      max_lng: Math.max(...lngs)
    };
  } else if (geometry && Array.isArray(geometry) && geometry.length === 4) {
    // 如果是bounds格式 [min_lat, min_lng, max_lat, max_lng]
    return {
      min_lat: geometry[0],
      min_lng: geometry[1],
      max_lat: geometry[2],
      max_lng: geometry[3]
    };
  } else if (geometry && geometry.min_lat !== undefined) {
    // 如果已经是bounds对象
    return geometry;
  }
  
  throw new Error('无法解析几何信息');
}

/**
 * 经纬度转像素坐标
 * @param {number} lat - 纬度
 * @param {number} lng - 经度
 * @param {number} zoom - 缩放级别
 * @returns {object} 像素坐标 {x, y}
 */
function latlngToPixel(lat, lng, zoom) {
  const tileSize = 256;
  const n = Math.pow(2, zoom);
  const x = (lng + 180) / 360 * tileSize * n;
  const latRad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * tileSize * n;
  
  return { x, y };
}

/**
 * 像素坐标转经纬度
 * @param {number} x - 像素x坐标
 * @param {number} y - 像素y坐标
 * @param {number} zoom - 缩放级别
 * @returns {object} 经纬度 {lat, lng}
 */
function pixelToLatLng(x, y, zoom) {
  const tileSize = 256;
  const n = Math.pow(2, zoom);
  const lng = x / tileSize / n * 360 - 180;
  const yRad = 1 - 2 * y / tileSize / n;
  const lat = 180 / Math.PI * Math.atan(Math.sinh(Math.PI * yRad));
  
  return { lat, lng };
}

/**
 * 更新目标截图弹窗UI
 * @param {number} year1 - 第一年份
 * @param {number} year2 - 第二年份
 */
function updateTargetScreenshotModalUI(year1, year2) {
  const image1El = document.getElementById('screenshotImage1');
  const image2El = document.getElementById('screenshotImage2');
  const image1Title = document.getElementById('screenshotImage1Title');
  const image2Title = document.getElementById('screenshotImage2Title');

  if (image1Title) image1Title.textContent = `${year1}年`;
  if (image2Title) image2Title.textContent = `${year2}年`;

  if (targetScreenshotImages.image1) {
    image1El.src = `data:image/png;base64,${targetScreenshotImages.image1}`;
  } else {
    image1El.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  }

  if (targetScreenshotImages.image2) {
    image2El.src = `data:image/png;base64,${targetScreenshotImages.image2}`;
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
 * 绑定目标截图按钮事件
 */
function bindTargetScreenshotEvents() {
  // 监听保存按钮点击
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('save-target-btn') || e.target.closest('.save-target-btn')) {
      const btn = e.target.classList.contains('save-target-btn') ? e.target : e.target.closest('.save-target-btn');
      const targetIndex = parseInt(btn.dataset.targetIndex);
      
      // 获取目标数据
      const targetItem = btn.closest('.result-item');
      const targetData = {
        geometry: null,
        bounds: []
      };
      
      try {
        targetData.geometry = parseGeometryFromDataset(targetItem.dataset.geometry);
      } catch (e) {
        console.error('解析几何信息失败:', e);
      }
      
      try {
        targetData.bounds = JSON.parse(targetItem.dataset.bounds || '[]');
      } catch (e) {
        console.error('解析边界信息失败:', e);
      }
      
      // 获取前后时相年份
      const beforeYear = changeDetectionData.before?.year || 2023;
      const afterYear = changeDetectionData.after?.year || 2025;
      
      // 调用保存函数
      saveTargetScreenshot(targetIndex, targetData, beforeYear, afterYear);
    }
  });
}

// 页面加载完成后绑定事件
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    bindTargetScreenshotEvents();
  }, 1000);
});