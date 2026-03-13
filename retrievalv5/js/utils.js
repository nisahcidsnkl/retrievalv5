// utils.js

// 全局变量，在其他模块中可能被引用
let map, drawnItems;
let selectedPolygon = null;
let targetLayers = [];
let currentTargets = [];
let savedImageBlob = null;
let savedMaskBlob = null;
let activeTargetId = null;
let tdtCiaLayer = null;
let layerControl = null;
let regionWmsLayer = null;
let currentTileLayer = null;

// 自定义绘制状态
let isDrawing = false;
let drawingLatLngs = [];
let tempLine = null;
let tempPolygon = null;
let vertexLayer = null;
let onMapDblClick = null;
let locMarker = null;

// 矢量图层管理
let vectorLayers = [];
let vectorPaneName = 'vectorPane';

// 示例图片管理
let sampleImages = {
  single: [],
  before: [],
  after: []
};

let activeSampleId = null;
let activeSamplePhase = null;

// 示例图绘制状态（canvas）
let isSampleDrawing = false;
let samplePoints = [];
let sampleScale = 1;
let sampleCanvas = null;
let sampleCtx = null;
let sampleKeyHandler = null;

// 搜索模式
let searchMode = 'single';
let changeSubMode = 'map';

// 变化检测相关
let changeDetectionData = {
  before: null,
  after: null
};

// 地图ROI状态
let mapROIPolygon = null;
let mapROILayer = null;


// 工具函数
function showLoadingIndicator(show, text = '正在搜索相似图斑...', subtext = '使用大模型进行特征匹配和聚合分析') {
  const loadingIndicator = document.getElementById('loadingIndicator');
  const loadingText = document.getElementById('loadingText');
  const loadingSubtext = document.getElementById('loadingSubtext');

  loadingText.textContent = text;
  loadingSubtext.textContent = subtext;
  loadingIndicator.style.display = show ? 'block' : 'none';
}

function base64ToBlob(base64, mimeType) {
  try {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  } catch (error) {
    console.error('Base64转换失败:', error);
    return new Blob([], { type: mimeType });
  }
}

function saveBlobToFile(blob, fileName) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

    return true;
  } catch (error) {
    console.error('保存文件失败:', error);
    return false;
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function getImageSizeFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function stripDataUrlHeader(dataUrl) {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  return base64ToBlob(b64, mime);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 25px;
    background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#F44336' : '#2196F3'};
    color: white;
    border-radius: 10px;
    box-shadow: 0 5px 15px rgba(0,0,0,0.2);
    z-index: 10001;
    animation: slideIn 0.3s ease-out;
    display: flex;
    align-items: center;
    max-width: 400px;
  `;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
  notification.innerHTML = `
    <span style="margin-right: 10px; font-size: 20px;">${icon}</span>
    <span>${message}</span>
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideIn 0.3s ease-out reverse';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

function parseGeometryFromDataset(dsValue) {
  if (!dsValue) return null;
  try {
    const decoded = decodeURIComponent(dsValue);
    const obj = JSON.parse(decoded);
    if (obj && typeof obj === 'object' && obj.type) return obj;
    return null;
  } catch (e) {
    return null;
  }
}

function updatePreviewFromBase64(imageBase64, maskBase64) {
  try {
    const imageBlob = base64ToBlob(imageBase64, 'image/png');
    const maskBlob = base64ToBlob(maskBase64, 'image/png');

    savedImageBlob = imageBlob;
    savedMaskBlob = maskBlob;

    const previewArea = document.getElementById('previewArea');
    previewArea.style.display = 'block';
    previewArea.classList.add('fade-in');

    const previewImage = document.getElementById('previewImage');
    const previewMask = document.getElementById('previewMask');

    if (previewImage.src) {
      try { URL.revokeObjectURL(previewImage.src); } catch (e) {}
    }
    if (previewMask.src) {
      try { URL.revokeObjectURL(previewMask.src); } catch (e) {}
    }

    previewImage.src = URL.createObjectURL(imageBlob);
    previewMask.src = URL.createObjectURL(maskBlob);
  } catch (error) {
    console.error('更新预览失败:', error);
    showNotification('预览更新失败', 'error');
  }
}

function updatePreviewFromDataUrl(imageDataUrl, maskDataUrl) {
  try {
    const imageBlob = dataUrlToBlob(imageDataUrl);
    const maskBlob = dataUrlToBlob(maskDataUrl);

    savedImageBlob = imageBlob;
    savedMaskBlob = maskBlob;

    const previewArea = document.getElementById('previewArea');
    previewArea.style.display = 'block';
    previewArea.classList.add('fade-in');

    const previewImage = document.getElementById('previewImage');

        const previewMask = document.getElementById('previewMask');

    

    

        if (previewImage.src) {

          try { URL.revokeObjectURL(previewImage.src); } catch (e) {}

        }

        if (previewMask.src) {

          try { URL.revokeObjectURL(previewMask.src); } catch (e) {}

        }

    

        previewImage.src = URL.createObjectURL(imageBlob);

        previewMask.src = URL.createObjectURL(maskBlob);

      } catch (e) {

        console.error(e);

        showNotification('预览更新失败', 'error');

      }

    }

function updateStatsPanel(stats) {
  const statsPanel = document.getElementById('statsPanel');
  if (!stats) {
    statsPanel.style.display = 'none';
    return;
  }

  const filteredCount = stats.filteredCount || 0;
  const targetCount = stats.targetCount || 0;
  const maxSimilarity = stats.maxSimilarity || '0%';
  const minSimilarity = stats.minSimilarity || '0%';
  const overallSimilarity = stats.overallSimilarity || '0%';

  document.getElementById('filteredCount').textContent = filteredCount;
  document.getElementById('targetCount').textContent = targetCount;
  document.getElementById('maxSimilarity').textContent = maxSimilarity;
  document.getElementById('minSimilarity').textContent = minSimilarity;
  document.getElementById('overallSimilarity').textContent = overallSimilarity;

  statsPanel.style.display = 'block';
  statsPanel.classList.add('fade-in');
}

function clearAllLayers() {
  targetLayers.forEach(layer => {
    if (layer && map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  });
  targetLayers = [];

  activeTargetId = null;
}

function resetToInitialState() {
  if (isDrawing) cancelDrawing();
  if (drawnItems) {
    drawnItems.clearLayers();
  }
  selectedPolygon = null;

  clearAllLayers();
  //===============================================
  // 清空示例图片选择
  if (sampleSelector) {
        sampleSelector.clearSelections();
  }
//===============================================
  document.getElementById('searchBtn').disabled = true;

  document.getElementById('resultList').style.display = 'none';

  const previewArea = document.getElementById('previewArea');
  previewArea.style.display = 'none';
  previewArea.classList.remove('fade-in');

  document.getElementById('statsPanel').style.display = 'none';
  document.getElementById('changeStatsPanel').style.display = 'none';
  document.getElementById('changePreviewImages').style.display = 'none';

  document.getElementById('controlPanel').style.display = 'none';
  document.getElementById('initialState').style.display = 'block';

  const previewImage = document.getElementById('previewImage');
  const previewMask = document.getElementById('previewMask');
  previewImage.src = '';
  previewMask.src = '';

  savedImageBlob = null;
  savedMaskBlob = null;

  document.getElementById('resultList').innerHTML = '';

  showNotification('已重置到初始状态', 'success');
}

// 坐标转换函数
function mercatorToWgs84(x, y) {
  const R = 6378137.0;
  const lon = (x / R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  return [lat, lon];
}

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lat, lon) {
  return (lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271);
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  ret += (20.0*Math.sin(6.0*x*PI) + 20.0*Math.sin(2.0*x*PI)) * 2.0/3.0;
  ret += (20.0*Math.sin(y*PI) + 40.0*Math.sin(y/3.0*PI)) * 2.0/3.0;
  ret += (160.0*Math.sin(y/12.0*PI) + 320*Math.sin(y*PI/30.0)) * 2.0/3.0;
  return ret;
}

function transformLon(x, y) {
  let ret = 300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  ret += (20.0*Math.sin(6.0*x*PI) + 20.0*Math.sin(2.0*x*PI)) * 2.0/3.0;
  ret += (20.0*Math.sin(x*PI) + 40.0*Math.sin(x/3.0*PI)) * 2.0/3.0;
  ret += (150.0*Math.sin(x/12.0*PI) + 300.0*Math.sin(x/30.0*PI)) * 2.0/3.0;
  return ret;
}

function wgs84ToGcj02(lat, lon) {
  if (outOfChina(lat, lon)) return [lat, lon];
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLon = (dLon * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return [lat + dLat, lon + dLon];
}

function gcj02ToWgs84(lat, lon) {
  if (outOfChina(lat, lon)) return [lat, lon];
  const [gLat, gLon] = wgs84ToGcj02(lat, lon);
  return [lat * 2 - gLat, lon * 2 - gLon];
}

function bd09ToGcj02(lat, lon) {
  const x = lon - 0.0065, y = lat - 0.006;
  const z = Math.sqrt(x*x + y*y) - 0.00002 * Math.sin(y * PI * 3000.0 / 180.0);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * PI * 3000.0 / 180.0);
  const ggLon = z * Math.cos(theta);
  const ggLat = z * Math.sin(theta);
  return [ggLat, ggLon];
}

function bd09ToWgs84(lat, lon) {
  const [gLat, gLon] = bd09ToGcj02(lat, lon);
  return gcj02ToWgs84(gLat, gLon);
}

function parsePossibleNumbers(input) {
  const parts = input.trim()
    .replace(/[，;]/g, ',')
    .replace(/\s+/g, ',')
    .split(',')
    .filter(Boolean)
    .map(s => Number(s));
  return parts;
}

function detectLatLonOrder(a, b) {
  const aIsLat = Math.abs(a) <= 90;
  const bIsLat = Math.abs(b) <= 90;
  if (aIsLat && !bIsLat) return [a, b];
  if (!aIsLat && bIsLat) return [b, a];
  return [a, b];
}

function showSearchHint(msg, show = true) {
  const el = document.getElementById('locSearchHint');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = show ? 'block' : 'none';
}

function setLocationMarker(lat, lon, label = '定位点') {
  if (!map) return;
  if (locMarker && map.hasLayer(locMarker)) map.removeLayer(locMarker);
  locMarker = L.marker([lat, lon]).addTo(map);
  locMarker.bindPopup(`<b>${label}</b><br/>${lat.toFixed(6)}, ${lon.toFixed(6)}`).openPopup();
}

function flyToLocation(lat, lon, zoom = 17, label = '定位点') {
  setLocationMarker(lat, lon, label);
  map.flyTo([lat, lon], zoom, { animate: true, duration: 1.2, easeLinearity: 0.25 });
}

function tryParseToWgs84(input, forcedType = 'auto') {
  const raw = input.trim();
  if (!raw) return { ok: false };

  let type = forcedType;
  let s = raw.toLowerCase();

  const prefixMatch = s.match(/^(wgs84|gcj02|bd09|epsg3857|3857)\s*[:：]\s*(.*)$/i);
  if (prefixMatch && forcedType === 'auto') {
    type = prefixMatch[1].toLowerCase();
    if (type === '3857') type = 'epsg3857';
    s = prefixMatch[2];
  } else {
    const head = s.split(/\s+/)[0];
    if (forcedType === 'auto' && ['wgs84','gcj02','bd09','epsg3857','3857'].includes(head)) {
      type = head === '3857' ? 'epsg3857' : head;
      s = s.replace(head, '').trim();
    }
  }

  const nums = parsePossibleNumbers(s);
  if (nums.length < 2 || !isFinite(nums[0]) || !isFinite(nums[1])) return { ok: false };

  if (type === 'auto') {
    const a = nums[0], b = nums[1];
    if (Math.abs(a) > 1000 && Math.abs(b) > 1000) type = 'epsg3857';
    else type = 'wgs84';
  }

  if (type === 'epsg3857') {
    const a = nums[0], b = nums[1];
    const x = Math.abs(a) >= Math.abs(b) ? a : b;
    const y = Math.abs(a) >= Math.abs(b) ? b : a;
    const [lat, lon] = mercatorToWgs84(x, y);
    return { ok: true, lat, lon, type: 'epsg3857' };
  }

  let [lat, lon] = detectLatLonOrder(nums[0], nums[1]);

  if (type === 'wgs84') return { ok: true, lat, lon, type: 'wgs84' };
  if (type === 'gcj02') {
    const [wLat, wLon] = gcj02ToWgs84(lat, lon);
    return { ok: true, lat: wLat, lon: wLon, type: 'gcj02' };
  }
  if (type === 'bd09') {
    const [wLat, wLon] = bd09ToWgs84(lat, lon);
    return { ok: true, lat: wLat, lon: wLon, type: 'bd09' };
  }

  return { ok: false };
}

async function geocodePlaceName(q) {
  const res = await fetch(`${Config.serverUrl}/geocode`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ q })
  });

  const data = await res.json();

  const latlng = extractLatLngFromGeocodeResponse(data);
  if (!latlng) {
    throw new Error('未找到该地名的坐标');
  }
  return { lat: latlng[0], lng: latlng[1], raw: data };
}

function extractLatLngFromGeocodeResponse(resp) {
  const toNum = (v) => (v === null || v === undefined) ? null : Number(v);

  if (resp && resp.status === 'success') {
    const lat = toNum(resp.lat);
    const lng = toNum(resp.lng ?? resp.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }

  const loc1 = resp?.data?.location;
  if (loc1) {
    const lat = toNum(loc1.lat);
    const lng = toNum(loc1.lng ?? loc1.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }

  const loc2 = resp?.raw?.location;
  if (loc2) {
    const lat = toNum(loc2.lat);
    const lng = toNum(loc2.lng ?? loc2.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }

  return null;
 }
// utils.js - 确保有这个函数
function stripDataUrlHeader(dataUrl) {
  if (!dataUrl) return dataUrl;
  // 如果是 data:image/png;base64, 格式，去掉前缀
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex !== -1 && dataUrl.startsWith('data:')) {
    return dataUrl.substring(commaIndex + 1);
  }
  return dataUrl;
}

// utils.js - 确保有这个函数
function buildMaskDataUrlFromPolygon(roiPoints) {
  if (!roiPoints || roiPoints.length < 3) {
    throw new Error('ROI点不足，无法构建掩码');
  }

  // 创建一个256x256的canvas
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // 清空为黑色（0）
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 256, 256);

  // 设置填充为白色（255）
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;

  // 开始绘制多边形
  ctx.beginPath();
  ctx.moveTo(roiPoints[0].x, roiPoints[0].y);

  for (let i = 1; i < roiPoints.length; i++) {
    ctx.lineTo(roiPoints[i].x, roiPoints[i].y);
  }

  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 转换为data URL
  return canvas.toDataURL('image/png');
}