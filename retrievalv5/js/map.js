// map.js:地图初始化函数：包括初始化遥感底图、切换遥感底图、行政区域图层、天地图地名图层
async function initMap() {
  // 首先获取可用年份
  try {
    const response = await fetch(`${Config.serverUrl}/available_years`);
    const data = await response.json();

    if (data.status === 'success') {
      // 使用数据库和文件系统交集作为可用年份
      Config.availableYears = data.intersection || [];

      if (Config.availableYears.length === 0) {
        // 如果没有可用年份，使用默认值
        Config.availableYears = [2023, 2025];
      }

      // 设置当前年份为最新年份
      Config.currentYear = Math.max(...Config.availableYears);

      console.log('可用年份:', Config.availableYears);
      console.log('当前年份:', Config.currentYear);
    } else {
      throw new Error('获取年份列表失败');
    }
  } catch (error) {
    console.error('获取年份列表失败，使用默认值:', error);
    Config.availableYears = [2023, 2025];
    Config.currentYear = 2025;
  }

  map = L.map('map', {
    attributionControl: false,
    zoomControl: false,
    zoomSnap: 1,
    zoomDelta: 1,
    crs: L.CRS.EPSG3857,
    fadeAnimation: true,
    zoomAnimation: true,
    markerZoomAnimation: true,
    maxZoom: 18,
    minZoom: 12
  }).setView(Config.mapCenter, Config.initialZoom);

  map.createPane('tdtOverlayPane');
  map.getPane('tdtOverlayPane').style.zIndex = 650;
  map.createPane(vectorPaneName);
  map.getPane(vectorPaneName).style.zIndex = 700;
  map.createPane('regionPane');
  map.getPane('regionPane').style.zIndex = 640;

  L.control.attribution({
    prefix: '<i class="fas fa-satellite"></i> 全域AI图侦系统'
  }).addTo(map);

  // 初始化瓦片图层
  currentTileLayer = L.tileLayer(Config.getTileUrl(Config.currentYear), {
    minZoom: 12,
    maxZoom: 18,
    tms: false,
    noWrap: true,
    attribution: '© 全域AI图侦系统',
    errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAANBJREFUeF7t0cENwCAIRMHUYoH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwAAAABJRU5ErkJggg==',
    tileSize: 256,
    zoomOffset: 0,
    zoomReverse: false
  }).addTo(map);

  tdtCiaLayer = L.tileLayer(
    Config.tdtCiaUrl.replace('{tk}', Config.tdtTk),
    {
      subdomains: Config.tdtSubdomains,
      pane: 'tdtOverlayPane',
      opacity: 1.0,
      minZoom: 1,
      maxZoom: 18,
      maxNativeZoom: 18,
      tileSize: 256,
      crossOrigin: true,
      attribution: '© 天地图 影像注记',
    }
  );

  regionWmsLayer = L.tileLayer.wms('http://dev.yunqi-tech.net:19080/geoserver/skybot/wms', {
    layers: 'skybot:georegion_l4',
    styles: 'skybot:region',
    format: 'image/png',
    transparent: true,
    tiled: true,
    version: '1.1.1',
    pane: 'regionPane',
    attribution: '© GeoServer 行政边界'
  });

  drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  layerControl = L.control.layers(
    null,
    {
      '行政边界矢量': regionWmsLayer,
      '是否叠加路网（天地图注记）': tdtCiaLayer
    },
    { position: 'bottomleft', collapsed: false }
  ).addTo(map);

  // 初始化时间轴
  initTimeline();
}


function initTimeline() {
  const timelineButtons = document.querySelector('.timeline-buttons');
  timelineButtons.innerHTML = '';

  // 按年份从小到大排列
  const sortedYears = [...Config.availableYears].sort((a, b) => a - b);

  sortedYears.forEach(year => {
    const button = document.createElement('button');
    button.className = `timeline-btn ${year === Config.currentYear ? 'active' : ''}`;
    button.dataset.year = year;
    button.textContent = year;
    button.addEventListener('click', () => switchTileLayer(year));
    timelineButtons.appendChild(button);
  });

  // 更新时间轴描述
  const separator = document.querySelector('.timeline-separator');
  if (separator) {
    const nextElement = separator.nextElementSibling;
    if (nextElement && nextElement.tagName === 'DIV') {
      nextElement.innerHTML = `点击切换底图时相，当前加载${Config.availableYears.length}个年份`;
    }
  }
}

function switchTileLayer(year) {
  if (Config.currentYear === year) return;

  Config.currentYear = year;

  if (currentTileLayer) {
    map.removeLayer(currentTileLayer);
  }

  currentTileLayer = L.tileLayer(Config.getTileUrl(year), {
    minZoom: 12,
    maxZoom: 18,
    tms: false,
    noWrap: true,
    attribution: '© 全域AI图侦系统',
    errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAANBJREFUeF7t0cENwCAIRMHUYoH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwH8C00YwAAAABJRU5ErkJggg=='
  }).addTo(map);

  // 更新时间轴按钮状态
  document.querySelectorAll('.timeline-btn').forEach(btn => {
    if (btn.dataset.year === year.toString()) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  showNotification(`已切换到${year}年影像`, 'success');
}
