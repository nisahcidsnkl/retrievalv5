//config.js
const Config = {
  serverUrl: 'http://localhost:5008',
  zoomLevel: 18,
  tileSize: 256,
  patchSize: 64,
  mapCenter: [30.186271, 120.259741],
  initialZoom: 15,
  // 移除写死的tileBaseUrls，改为动态生成
  getTileUrl: function(year) {
    return `${this.serverUrl}/tiles/${year}/{z}/{x}/{y}.png`;
  },
  // 当前年份将由后端动态设置
  currentYear: null,
  availableYears: [], // 从后端获取的可用年份列表
  crs: L.CRS.EPSG3857,
  debugMode: false,
  tdtTk: '58f399d796a4492714986a3b1285bc41',
  tdtCiaUrl:
    'https://t{s}.tianditu.gov.cn/cia_w/wmts?' +
    'SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    '&LAYER=cia&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles' +
    '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
    '&tk={tk}',
  tdtSubdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
  geocodeProvider: 'tianditu',
  geocodeDirectInBrowser: false,
  geocodeProxyUrl: 'http://localhost:5007/geocode',
  samplesUrl: 'http://localhost:5007/samples',
  masksUrl: 'http://localhost:5007/masks'
};