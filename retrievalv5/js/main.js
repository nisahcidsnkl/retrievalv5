// main.js
// 前端初始化：包括地图初始化、事件初始化、加载示例图片、顶部搜索框，初始化完成后显示后端连接信息。

// 顶部搜索框定位功能
function initLocSearch() {
  const locInput = document.getElementById('locSearchInput');
  const locBtn = document.getElementById('locSearchBtn');
  const locType = document.getElementById('locCoordType');

  async function handleLocSearch() {
    const text = (locInput?.value || '').trim();
    if (!text) {
      showSearchHint('请输入地名或坐标。', true);
      return;
    }
    showSearchHint('', false);

    const forced = locType?.value || 'auto';
    const parsed = tryParseToWgs84(text, forced);
    if (parsed.ok) {
      flyToLocation(parsed.lat, parsed.lon, 17, `坐标定位(${parsed.type})`);
      showNotification(`已定位：${parsed.lat.toFixed(6)}, ${parsed.lon.toFixed(6)}`, 'success');
      return;
    }

    try {
      showNotification('正在地名检索...', 'info');
      const geo = await geocodePlaceName(text);
      flyToLocation(geo.lat, geo.lng, 17, `地名：${text}`);
      showNotification(`地名定位成功：${text} (${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)})`, 'success');
    } catch (e) {
      console.error('地名检索失败:', e);
      showNotification(`地名检索失败：${e.message}`, 'error');
      showSearchHint('地名检索失败：请确认后端已配置 TDT_TK，且可访问天地图 geocoder。', true);
    }
  }

  locBtn.addEventListener('click', handleLocSearch);
  locInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLocSearch();
  });
}


// 初始化
window.onload = async () => {
  // 先初始化地图（地图初始化函数会获取年份）
  await initMap();
  initEvents();
  initLocSearch();
  console.log('地图初始化完成');


  // 检查后端状态
  fetch(`${Config.serverUrl}/health`)
    .then(response => response.json())
    .then(data => {
      console.log(`后端状态: ${data.status}, 特征库数量: ${data.feature_count}`);
      console.log(`可用年份: ${data.available_years}`);
      showNotification(`后端服务连接成功，特征库: ${data.feature_count}个，加载${Config.availableYears.length}个年份影像`, 'success');
    })
    .catch(error => {
      console.error('后端连接失败:', error);
      showNotification('警告：无法连接到后端服务，请确保后端已启动', 'error');
    });
};

