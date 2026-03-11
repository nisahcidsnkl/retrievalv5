// drawing.js
//地图ROI绘制管理
function startPolygonDrawing() {
  if (selectedPolygon && drawnItems) {
    drawnItems.removeLayer(selectedPolygon);
    selectedPolygon = null;
  }

  isDrawing = true;
  drawingLatLngs = [];

  map.doubleClickZoom.disable();
  if (!onMapDblClick) {
    onMapDblClick = (e) => {
      if (!isDrawing) return;

      if (e && e.originalEvent) {
        L.DomEvent.preventDefault(e.originalEvent);
        L.DomEvent.stopPropagation(e.originalEvent);
      }
      finishDrawing();
    };
  }
  map.on('dblclick', onMapDblClick);

  if (tempLine && map.hasLayer(tempLine)) map.removeLayer(tempLine);
  if (tempPolygon && map.hasLayer(tempPolygon)) map.removeLayer(tempPolygon);
  if (vertexLayer && map.hasLayer(vertexLayer)) map.removeLayer(vertexLayer);

  tempLine = L.polyline([], { color: '#667eea', weight: 3, dashArray: '6 6' }).addTo(map);
  tempPolygon = L.polygon([], { color: '#667eea', weight: 2, fillColor: '#667eea', fillOpacity: 0.15 }).addTo(map);

  vertexLayer = L.layerGroup().addTo(map);
  document.getElementById('searchBtn').disabled = true;

  showNotification('绘制模式：左键点选顶点，双击结束；Ctrl+Z 撤销；Esc 取消。', 'info');
}

function updateTempShapes() {
  if (!tempLine || !tempPolygon) return;
  tempLine.setLatLngs(drawingLatLngs);

  if (drawingLatLngs.length >= 3) {
    tempPolygon.setLatLngs(drawingLatLngs);
  } else {
    tempPolygon.setLatLngs([]);
  }
  refreshVertexMarkers();
}

function refreshVertexMarkers() {
  if (!vertexLayer) return;

  vertexLayer.clearLayers();

  drawingLatLngs.forEach((latlng, idx) => {
    const isLast = idx === drawingLatLngs.length - 1;

    L.circleMarker(latlng, {
      radius: isLast ? 6 : 5,
      weight: 2,
      color: '#667eea',
      fillColor: '#ffffff',
      fillOpacity: 0.35
    }).addTo(vertexLayer);
  });
}

function addDrawingPoint(latlng) {
  if (!isDrawing) return;
  drawingLatLngs.push(latlng);
  updateTempShapes();
}

function undoLastPoint() {
  if (!isDrawing) return;
  if (drawingLatLngs.length === 0) return;

  drawingLatLngs.pop();
  updateTempShapes();
  showNotification('已撤销上一个顶点', 'info');
}

function cancelDrawing() {
  if (!isDrawing) return;

  isDrawing = false;
  drawingLatLngs = [];

  if (tempLine && map.hasLayer(tempLine)) map.removeLayer(tempLine);
  if (tempPolygon && map.hasLayer(tempPolygon)) map.removeLayer(tempPolygon);
  if (vertexLayer && map.hasLayer(vertexLayer)) map.removeLayer(vertexLayer);
  vertexLayer = null;
  tempLine = null;
  tempPolygon = null;

  if (onMapDblClick) {
    map.off('dblclick', onMapDblClick);
  }

  map.doubleClickZoom.enable();
  document.getElementById('searchBtn').disabled = true;

  showNotification('已取消绘制', 'info');
}

function finishDrawing() {
  if (!isDrawing) return;

  if (drawingLatLngs.length < 3) {
    showNotification('至少需要3个点才能形成多边形', 'error');
    return;
  }

  isDrawing = false;

  if (onMapDblClick) {
    map.off('dblclick', onMapDblClick);
  }

  if (tempLine && map.hasLayer(tempLine)) map.removeLayer(tempLine);
  if (tempPolygon && map.hasLayer(tempPolygon)) map.removeLayer(tempPolygon);
  if (vertexLayer && map.hasLayer(vertexLayer)) map.removeLayer(vertexLayer);
  vertexLayer = null;
  tempLine = null;
  tempPolygon = null;

  const layer = L.polygon(drawingLatLngs, {
    color: '#667eea',
    fillColor: '#667eea',
    fillOpacity: 0.2,
    weight: 3
  });

  drawnItems.addLayer(layer);
  selectedPolygon = layer;

  map.doubleClickZoom.enable();
  document.getElementById('searchBtn').disabled = false;

  showNotification('区域绘制完成，可以开始搜索', 'success');
}

// 示例图绘制相关
function startSamplePolygonDrawing() {
  isSampleDrawing = true;
  samplePoints = [];
  renderSampleOverlay();
  syncSampleButtons();
  showNotification('示例图绘制：单击加点，双击结束；Ctrl+Z 撤销；Esc 取消。', 'info');
}

function addSamplePointFromMouseEvent(e) {
  const rect = sampleCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const x256 = clamp(Math.round(mx / sampleScale), 0, 255);
  const y256 = clamp(Math.round(my / sampleScale), 0, 255);

  samplePoints.push({ x: x256, y: y256 });
  renderSampleOverlay();
  syncSampleButtons();
}

function undoSamplePoint() {
  if (!isSampleDrawing) return;
  if (!samplePoints.length) return;
  samplePoints.pop();
  renderSampleOverlay();
  syncSampleButtons();
  showNotification('已撤销上一个点', 'info');
}

function cancelSampleDrawing() {
  if (!isSampleDrawing) return;
  isSampleDrawing = false;
  samplePoints = [];
  renderSampleOverlay();
  syncSampleButtons();
  showNotification('已取消示例图绘制', 'info');
}

function finishSampleDrawing() {
  if (!isSampleDrawing) return;
  if (samplePoints.length < 3) {
    showNotification('至少需要3个点才能形成多边形', 'error');
    return;
  }
  isSampleDrawing = false;

  renderSampleOverlay();
  syncSampleButtons();
  showNotification('示例图区域绘制完成，可以保存或搜索', 'success');
}

function renderSampleOverlay() {
  if (!sampleCanvas || !sampleCtx) return;

  sampleCtx.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);

  const pts = samplePoints.map(p => ({
    x: p.x * sampleScale,
    y: p.y * sampleScale
  }));

  if (pts.length >= 2) {
    sampleCtx.save();
    sampleCtx.lineWidth = 2;
    sampleCtx.strokeStyle = '#667eea';
    sampleCtx.setLineDash([8, 6]);

    sampleCtx.beginPath();
    sampleCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) sampleCtx.lineTo(pts[i].x, pts[i].y);
    sampleCtx.stroke();
    sampleCtx.restore();
  }

  if (pts.length >= 3) {
    sampleCtx.save();
    sampleCtx.fillStyle = 'rgba(102,126,234,0.18)';
    sampleCtx.strokeStyle = '#667eea';
    sampleCtx.lineWidth = 2;
    sampleCtx.setLineDash([]);

    sampleCtx.beginPath();
    sampleCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i <pts.length; i++) sampleCtx.lineTo(pts[i].x, pts[i].y);
    sampleCtx.closePath();
    sampleCtx.fill();
    sampleCtx.stroke();
    sampleCtx.restore();
  }

  pts.forEach((p, idx) => {
    const isLast = idx === pts.length - 1;
    sampleCtx.save();
    sampleCtx.beginPath();
    sampleCtx.arc(p.x, p.y, isLast ? 6 : 5, 0, Math.PI * 2);
    sampleCtx.fillStyle = 'rgba(255,255,255,0.75)';
    sampleCtx.fill();
    sampleCtx.lineWidth = 2;
    sampleCtx.strokeStyle = '#667eea';
    sampleCtx.stroke();
    sampleCtx.restore();
  });
}

function buildMaskDataUrlFromPolygon(points256) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, 256, 256);

  ctx.beginPath();
  ctx.moveTo(points256[0].x, points256[0].y);
  for (let i = 1; i < points256.length; i++) {
    ctx.lineTo(points256[i].x, points256[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = 'white';
  ctx.fill();

  return c.toDataURL('image/png');
}

// 地图ROI绘制
function startMapROIDrawing() {
  if (mapROILayer && map.hasLayer(mapROILayer)) {
    map.removeLayer(mapROILayer);
  }

  mapROIPolygon = null;

  startPolygonDrawingForROI();
}

function startPolygonDrawingForROI() {
  if (isDrawing) return;

  isDrawing = true;
  drawingLatLngs = [];

  map.doubleClickZoom.disable();
  if (!onMapDblClick) {
    onMapDblClick = (e) => {
      if (!isDrawing) return;

      if (e && e.originalEvent) {
        L.DomEvent.preventDefault(e.originalEvent);
        L.DomEvent.stopPropagation(e.originalEvent);
      }
      finishROIDrawing();
    };
  }
  map.on('dblclick', onMapDblClick);

  if (tempLine && map.hasLayer(tempLine)) map.removeLayer(tempLine);
  if (tempPolygon && map.hasLayer(tempPolygon)) map.removeLayer(tempPolygon);
  if (vertexLayer && map.hasLayer(vertexLayer)) map.removeLayer(vertexLayer);

  tempLine = L.polyline([], { color: '#ff4444', weight: 3, dashArray: '6 6' }).addTo(map);
  tempPolygon = L.polygon([], { color: '#ff4444', weight: 2, fillColor: '#ff4444', fillOpacity: 0.15 }).addTo(map);

  vertexLayer = L.layerGroup().addTo(map);

  document.getElementById('roiInfo').textContent = '正在绘制ROI区域...';
  document.getElementById('drawROIBtn').disabled = true;
  document.getElementById('clearROIBtn').disabled = true;
  document.getElementById('saveBeforeFromMapBtn').disabled = true;
  document.getElementById('saveAfterFromMapBtn').disabled = true;

  showNotification('正在绘制ROI区域：左键点选顶点，双击结束；Ctrl+Z 撤销；Esc 取消。', 'info');
}

function finishROIDrawing() {
  if (!isDrawing) return;

  if (drawingLatLngs.length < 3) {
    showNotification('至少需要3个点才能形成多边形', 'error');
    return;
  }

  isDrawing = false;

  if (onMapDblClick) {
    map.off('dblclick', onMapDblClick);
  }

  if (tempLine && map.hasLayer(tempLine)) map.removeLayer(tempLine);
  if (tempPolygon && map.hasLayer(tempPolygon)) map.removeLayer(tempPolygon);
  if (vertexLayer && map.hasLayer(vertexLayer)) map.removeLayer(vertexLayer);
  vertexLayer = null;
  tempLine = null;
  tempPolygon = null;

  mapROIPolygon = drawingLatLngs;
  mapROILayer = L.polygon(mapROIPolygon, {
    color: '#ff4444',
    fillColor: '#ff4444',
    fillOpacity: 0.2,
    weight: 3
  }).addTo(map);

  map.doubleClickZoom.enable();

  const bounds = L.latLngBounds(mapROIPolygon);
  const center = bounds.getCenter();
  document.getElementById('roiInfo').innerHTML = `
    ROI区域已绘制完成<br/>
    中心位置: ${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}<br/>
    顶点数量: ${mapROIPolygon.length}
  `;

  document.getElementById('drawROIBtn').disabled = false;
  document.getElementById('clearROIBtn').disabled = false;
  document.getElementById('saveBeforeFromMapBtn').disabled = false;
  document.getElementById('saveAfterFromMapBtn').disabled = false;

  showNotification('ROI区域绘制完成，可以保存为示例图片', 'success');
}

function clearMapROI() {
  if (mapROILayer && map.hasLayer(mapROILayer)) {
    map.removeLayer(mapROILayer);
  }

  mapROIPolygon = null;
  mapROILayer = null;

  document.getElementById('roiInfo').textContent = '未绘制ROI区域。请点击下方按钮在地图上绘制一个区域。';
  document.getElementById('clearROIBtn').disabled = true;
  document.getElementById('saveBeforeFromMapBtn').disabled = true;
  document.getElementById('saveAfterFromMapBtn').disabled = true;

  showNotification('已清空ROI区域', 'info');
}