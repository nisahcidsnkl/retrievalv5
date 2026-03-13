// ui.js
// 单时相搜索相关变量
let singleSelectedSample = null;
let singleMapROIPolygon = null;
let singleSubMode = 'map';

function setSingleSubMode(submode) {
  singleSubMode = submode;

  // 更新选项卡
  document.querySelectorAll('.single-submode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.submode === submode);
  });

  // 显示对应的模式内容
  if (submode === 'map') {
    document.getElementById('singleMapMode').style.display = 'block';
    document.getElementById('singleUploadMode').style.display = 'none';
    document.getElementById('singlePhaseStatus').textContent = '未配置';

    // 检查是否已绘制ROI
    if (selectedPolygon) {
      document.getElementById('singleRoiInfo').textContent = '已绘制搜索区域，点击"开始搜索"进行搜索';
      document.getElementById('clearSingleROIBtn').disabled = false;
      document.getElementById('searchBtn').disabled = false;
    }
  } else if (submode === 'upload') {
    document.getElementById('singleMapMode').style.display = 'none';
    document.getElementById('singleUploadMode').style.display = 'block';

    // 移除年份下拉框填充调用
    // populateSingleYearSelector();  // 不再需要

    // 显示当前时间轴年份
    const currentYear = Config.currentYear;
    const yearDisplay = document.getElementById('singleYearDisplay');
    if (yearDisplay) {
      yearDisplay.textContent = currentYear;
    }

    checkSingleSearchReady();
  }
}

// 填充单时相年份选择器
async function populateSingleYearSelector() {
  try {
    const yearSelect = document.getElementById('singlePhaseYear');
    if (!yearSelect) return;

    // 获取年份列表
    const years = await fetchAvailableYears();

    // 清除现有选项（除了第一个）
    while (yearSelect.options.length > 1) {
      yearSelect.remove(1);
    }

    // 填充年份
    years.forEach(year => {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = year;
      yearSelect.appendChild(option);
    });

    // 默认选择当前年份
    if (years.includes(Config.currentYear)) {
      yearSelect.value = Config.currentYear;
    }
  } catch (error) {
    console.error('填充单时相年份失败:', error);
  }
}

function checkSingleSearchReady() {
  if (singleSubMode === 'map') {
    const ready = !!selectedPolygon;          // 地图模式：必须有绘制的多边形
    document.getElementById('searchBtn').disabled = !ready;
    return ready;
  }

  // 上传图片模式：只需要有图片，年份由时间轴提供
  const ready = singleSelectedSample !== null;
  document.getElementById('searchBtn').disabled = !ready;

  // 更新状态文本
  const statusEl = document.getElementById('singlePhaseStatus');
  if (statusEl) {
    statusEl.textContent = ready ? '已配置' : '未配置';
    statusEl.style.color = ready ? '#4CAF50' : '#F44336';
  }
  return ready;
}

function selectSingleSample(sample) {
  singleSelectedSample = sample;

  // 同时更新 sampleImages 对象，确保搜索时能找到
  if (sample && sample.id) {
    // 检查是否已存在于 sampleImages.single 中
    const existingIndex = sampleImages.single.findIndex(s => s.id === sample.id);
    const sampleData = {
      id: sample.id,
      name: sample.name,
      dataUrl: sample.imageUrl, // 确保有 dataUrl
      roiPoints: sample.roiPoints || [],
      year: sample.year
    };

    if (existingIndex >= 0) {
      sampleImages.single[existingIndex] = sampleData;
    } else {
      sampleImages.single.push(sampleData);
    }
  }

  // 更新预览
  const previewEl = document.getElementById('singleSelectedPreview');
  const imageEl = document.getElementById('singleSelectedImage');
  const nameEl = document.getElementById('singleSelectedName');
  const yearDisplay = document.getElementById('singleYearDisplay');
  const statusEl = document.getElementById('singlePhaseStatus');

  if (sample) {
    // 显示预览
    previewEl.style.display = 'block';
    imageEl.src = sample.imageUrl;
    imageEl.style.display = 'block';
    nameEl.textContent = sample.name;

    // 显示当前时间轴年份
    if (yearDisplay) {
      yearDisplay.textContent = Config.currentYear;
    }

    // 更新状态显示
    if (statusEl) {
      statusEl.textContent = '已配置';
      statusEl.style.color = '#4CAF50';
    }
  } else {
    // 隐藏预览
    previewEl.style.display = 'none';
    imageEl.src = '';
    nameEl.textContent = '';

    // 更新状态显示
    if (statusEl) {
      statusEl.textContent = '未配置';
      statusEl.style.color = '#F44336';
    }
  }

  // 强制更新搜索按钮状态
  setTimeout(() => {
    checkSingleSearchReady();
    updateSearchButtonState();
  }, 100);
}

// 添加专门的搜索按钮状态更新函数
function updateSearchButtonState() {
  const searchBtn = document.getElementById('searchBtn');

  if (searchMode === 'single') {
    if (singleSubMode === 'map') {
      // 地图模式：检查是否已绘制多边形
      searchBtn.disabled = !selectedPolygon;
    } else {
      // 上传图片模式：检查是否已选择图片和年份
      const yearSelected = document.getElementById('singlePhaseYear')?.value !== '';
      searchBtn.disabled = !(singleSelectedSample && yearSelected);
    }
  } else {
    // 变化检测模式保持原有逻辑
    searchBtn.disabled = !checkChangeDetectionReady();
  }
}

// 增强检查函数
function checkSingleSearchReady() {
  const isMapMode = singleSubMode === 'map';
  let isReady = false;

  if (isMapMode) {
    // 地图模式：检查是否已绘制多边形
    isReady = selectedPolygon !== null;
  } else {
    // 上传图片模式：检查是否已选择图片和年份
    const yearSelected = document.getElementById('singlePhaseYear')?.value !== '';
    isReady = singleSelectedSample !== null && yearSelected;
  }

  // 更新状态文本
  const statusEl = document.getElementById('singlePhaseStatus');
  if (statusEl && !isMapMode) {
    if (isReady) {
      statusEl.textContent = '已配置';
      statusEl.style.color = '#4CAF50';
    } else {
      statusEl.textContent = '未配置';
      statusEl.style.color = '#F44336';
    }
  }

  return isReady;
}

// 移除已选的单时相图片
function removeSingleSample() {
  singleSelectedSample = null;
  selectSingleSample(null);
}

// 开始绘制单时相ROI
function startSingleMapROIDrawing() {
  if (isDrawing) {
    showNotification('请先完成当前绘制', 'warning');
    return;
  }

  document.getElementById('drawSingleROIBtn').disabled = true;
  document.getElementById('singleRoiInfo').textContent = '正在绘制... 单击地图添加顶点，双击结束绘制';

  // 清除之前的绘制
  if (selectedPolygon) {
    drawnItems.clearLayers();
    selectedPolygon = null;
  }

  // 开始绘制
  startPolygonDrawing();

  // 监听绘制完成
  map.on('draw:created', function(e) {
    const layer = e.layer;
    drawnItems.clearLayers();
    drawnItems.addLayer(layer);
    selectedPolygon = layer;

    document.getElementById('drawSingleROIBtn').disabled = false;
    document.getElementById('clearSingleROIBtn').disabled = false;
    document.getElementById('singleRoiInfo').textContent = '已绘制搜索区域，点击"开始搜索"进行搜索';

    checkSingleSearchReady();
  });
}

// 清空单时相ROI
function clearSingleMapROI() {
  if (selectedPolygon) {
    drawnItems.clearLayers();
    selectedPolygon = null;

    document.getElementById('clearSingleROIBtn').disabled = true;
    document.getElementById('singleRoiInfo').textContent = '请先在地图上绘制感兴趣的区域，然后点击开始搜索。';

    checkSingleSearchReady();
    showNotification('已清空搜索区域', 'success');
  }
}

// 执行单时相搜索（根据模式选择不同的搜索方式）
async function performSingleSearch() {
  if (!checkSingleSearchReady()) {
    showNotification('请先配置搜索条件', 'error');
    return;
  }

  try {
    if (singleSubMode === 'map') {
      // 地图ROI模式：使用原有搜索逻辑
      await performSearch();
    } else {
      // 上传图片模式：使用样本搜索逻辑
      await performSingleSearchBySample();
    }
  } catch (error) {
    console.error('单时相搜索失败:', error);
    showNotification(`搜索失败: ${error.message}`, 'error');
  }
}
async function performSingleSearchBySample() {
  if (!singleSelectedSample) {
    showNotification('请先选择示例图片', 'error');
    return;
  }

  // 获取当前时间轴选中的年份
  const currentYear = Config.currentYear;
  if (!currentYear) {
    showNotification('无法获取当前年份', 'error');
    return;
  }

  try {
    showLoadingIndicator(true, '正在搜索...', '提取特征并搜索');

    if (!singleSelectedSample.roiPoints || singleSelectedSample.roiPoints.length < 3) {
      throw new Error('示例图片没有有效的ROI区域');
    }

    // 调用 search.js 中的函数，传入当前年份
    await performSearchBySampleImage(singleSelectedSample.id, currentYear);
  } catch (error) {
    showLoadingIndicator(false);
    console.error('单时相搜索失败:', error);
    showNotification(`搜索失败: ${error.message}`, 'error');
    throw error;
  }
}
function initSingleSearchEvents() {
  // 移除年份选择变化事件监听

  // 子模式切换
  document.querySelectorAll('.single-submode-tab').forEach(tab => {
    tab.addEventListener('click', () => setSingleSubMode(tab.dataset.submode));
  });

  // 移除图片按钮
  document.getElementById('removeSingleSampleBtn').addEventListener('click', removeSingleSample);

  // 文件上传输入（直接上传图片，不是从库选择）
  document.getElementById('singlePhaseUploadInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      await addSampleImageFile(files[0], 'single');
      e.target.value = '';
    } catch (error) {
      console.error('上传失败:', error);
      showNotification(`上传失败: ${error.message}`, 'error');
    }
  });
}

function openSampleModal(sampleId, phase = 'single') {
  let s = null;
  if (phase === 'single') {
    s = sampleImages.single.find(x => x.id === sampleId);
  } else if (phase === 'before') {
    s = sampleImages.before.find(x => x.id === sampleId);
  } else if (phase === 'after') {
    s = sampleImages.after.find(x => x.id === sampleId);
  }

  if (!s) return;

  activeSampleId = sampleId;
  activeSamplePhase = phase;

  const modal = document.getElementById('sampleModal');
  const imgEl = document.getElementById('sampleModalImg');
  const nameEl = document.getElementById('sampleModalName');

  nameEl.textContent = s.name;
  imgEl.src = s.dataUrl;

  modal.style.display = 'flex';

  sampleCanvas = document.getElementById('sampleDrawCanvas');
  sampleCtx = sampleCanvas.getContext('2d');

  const wrap = document.getElementById('sampleCanvasWrap');
  const rect = wrap.getBoundingClientRect();
  const w = Math.floor(rect.width);
  const h = Math.floor(rect.height);
  sampleCanvas.width = w;
  sampleCanvas.height = h;

  sampleScale = w / 256;

  isSampleDrawing = false;
  samplePoints = s.roiPoints ? [...s.roiPoints] : [];
  renderSampleOverlay();

  syncSampleButtons();

  bindSampleModalEvents();
}

function closeSampleModal() {
  const modal = document.getElementById('sampleModal');
  modal.style.display = 'none';

  unbindSampleModalEvents();

  activeSampleId = null;
  activeSamplePhase = null;
  isSampleDrawing = false;
  samplePoints = [];
}

function syncSampleButtons() {
  const saveBtn = document.getElementById('sampleSaveBtn');
  const finishBtn = document.getElementById('sampleFinishSearchBtn');

  const hasROI = samplePoints.length >= 3;
  saveBtn.disabled = !hasROI;

  if (searchMode === 'single') {
    finishBtn.disabled = !hasROI;
  } else {
    finishBtn.disabled = true;
  }
}

function bindSampleModalEvents() {
  const closeBtn = document.getElementById('sampleModalCloseBtn');
  closeBtn.onclick = closeSampleModal;

  const modal = document.getElementById('sampleModal');
  modal.onclick = (e) => {
    if (e.target === modal) closeSampleModal();
  };

  document.getElementById('sampleStartDrawBtn').onclick = () => {
    startSamplePolygonDrawing();
  };

  document.getElementById('sampleSaveBtn').onclick = async () => {
    if (!samplePoints || samplePoints.length < 3) {
      showNotification('请先绘制ROI区域', 'error');
      return;
    }

    openSaveSampleModal();
  };

  document.getElementById('sampleFinishSearchBtn').onclick = async () => {
    if (!samplePoints || samplePoints.length < 3) {
      showNotification('请先绘制ROI区域', 'error');
      return;
    }

    const sid = activeSampleId;
    const pts = [...samplePoints];
    const phase = activeSamplePhase;
    closeSampleModal();

    try {
      if (searchMode === 'single') {
        await performSearchBySampleImage(sid, phase, pts);
      }
    } catch (e) {
      console.error(e);
      showNotification(`搜索失败：${e.message}`, 'error');
    }
  };

  sampleCanvas.onclick = (e) => {
    if (!isSampleDrawing) return;
    const d = e?.detail || 1;
    if (d >= 2) return;
    addSamplePointFromMouseEvent(e);
  };

  sampleCanvas.ondblclick = (e) => {
    if (!isSampleDrawing) return;
    e.preventDefault();
    e.stopPropagation();
    finishSampleDrawing();
  };

  sampleKeyHandler = (e) => {
    const modalEl = document.getElementById('sampleModal');
    if (!modalEl || modalEl.style.display === 'none') return;
    if (!isSampleDrawing) return;

    if (e.key === 'Escape') {
      cancelSampleDrawing();
      return;
    }

    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
    if (ctrlOrCmd && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      undoSamplePoint();
      return;
    }
  };

  document.addEventListener('keydown', sampleKeyHandler);
}

function unbindSampleModalEvents() {
  if (sampleCanvas) {
    sampleCanvas.onclick = null;
    sampleCanvas.ondblclick = null;
  }
  if (sampleKeyHandler) {
    document.removeEventListener('keydown', sampleKeyHandler);
    sampleKeyHandler = null;
  }
}

function closeSaveSampleModal() {
  const modal = document.getElementById('saveSampleModal');
  modal.style.display = 'none';
  unbindSaveSampleModalEvents();
}


function unbindSaveSampleModalEvents() {
  // Clean up event handlers if needed
}


// ============ 新增：年份加载功能 ============
// 从后端获取可用年份列表
async function fetchAvailableYears() {
  try {
    const response = await fetch(`${Config.serverUrl}/available_years`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();

    if (data.status === 'success') {
      // 使用交集年份，确保数据库和文件系统都有的年份
      const years = data.intersection || data.database_years || data.filesystem_years || [];
      return years.sort((a, b) => a - b); // 升序排序
    } else {
      console.error('获取年份列表失败:', data.message);
      return [];
    }
  } catch (error) {
    console.error('获取年份列表时出错:', error);
    return [];
  }
}

// 填充年份下拉框
async function populateYearSelectors() {
  try {
    const beforeYearSelect = document.getElementById('beforePhaseYear');
    const afterYearSelect = document.getElementById('afterPhaseYear');

    if (!beforeYearSelect || !afterYearSelect) {
      console.error('年份下拉框元素未找到');
      return;
    }

    // 获取年份列表
    const years = await fetchAvailableYears();

    if (years.length === 0) {
      console.warn('未找到可用年份数据');
      return;
    }

    // 清除现有选项（除了第一个"请选择年份"）
    while (beforeYearSelect.options.length > 1) {
      beforeYearSelect.remove(1);
    }
    while (afterYearSelect.options.length > 1) {
      afterYearSelect.remove(1);
    }

    // 填充年份选项
    years.forEach(year => {
      const option1 = document.createElement('option');
      option1.value = year;
      option1.textContent = year;
      beforeYearSelect.appendChild(option1);

      const option2 = document.createElement('option');
      option2.value = year;
      option2.textContent = year;
      afterYearSelect.appendChild(option2);
    });

    console.log('年份下拉框填充完成，可用年份:', years);
  } catch (error) {
    console.error('填充年份下拉框失败:', error);
  }
}
// ============ 年份加载功能结束 ============

// 初始化事件
function initEvents() {
  // 抽屉面板切换
  const drawerToggle = document.getElementById('drawerToggle');
  const drawerPanel = document.getElementById('drawerPanel');
  drawerToggle.addEventListener('click', () => {
    drawerPanel.classList.toggle('close');
    const icon = drawerToggle.querySelector('i');
    if (drawerPanel.classList.contains('close')) {
      drawerToggle.innerHTML = '<i class="fas fa-bars"></i>';
      drawerToggle.style.right = '25px';
    } else {
      drawerToggle.innerHTML = '<i class="fas fa-times"></i>';
      drawerToggle.style.right = '525px';
    }
  });

   // 初始化单时相搜索事件
  initSingleSearchEvents();

  // 修改搜索按钮事件
  document.getElementById('searchBtn').addEventListener('click', () => {
    if (searchMode === 'single') {
      performSingleSearch(); // 修改为调用新的统一函数
    } else {
      performChangeSearch(); // 变化检测保持原有逻辑
    }
  });

  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener('click', () => {
      if (drawerPanel.classList.contains('close')) return;

      drawerPanel.classList.add('close');
      drawerToggle.innerHTML = '<i class="fas fa-bars"></i>';
      drawerToggle.style.right = '25px';
    });
  }

  // 绘制按钮（从初始状态）
  document.getElementById('startDrawBtnIntro').addEventListener('click', () => {
    startDrawing();
  });
  //++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 同时，添加一个辅助函数来更新变化检测预览
function updateChangeDetectionDataFromSamples() {
  if (window.sampleSelector) {
    const beforeSample = window.sampleSelector.getSelectedSample('before');
    const afterSample = window.sampleSelector.getSelectedSample('after');

    if (beforeSample && afterSample) {
      updateChangeDetectionPreview(beforeSample, afterSample);
    }
  }
}

// 在选择示例图片后更新预览
if (window.sampleSelector) {
  // 监听选择变化
  const originalSelectSample = window.sampleSelector.selectSample;
  window.sampleSelector.selectSample = function(sample) {
    const result = originalSelectSample.call(this, sample);
    updateChangeDetectionDataFromSamples();
    return result;
  };
}
//==========================================================================

  function startDrawing() {
    startPolygonDrawing();
    document.getElementById('initialState').style.display = 'none';
    document.getElementById('controlPanel').style.display = 'block';
    document.getElementById('controlPanel').classList.add('fade-in');
  }

  // 清空按钮
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (isDrawing) cancelDrawing();
    drawnItems.clearLayers();
    selectedPolygon = null;
    document.getElementById('searchBtn').disabled = true;
    showNotification('已清空绘制区域', 'success');
  });

  // 重置按钮
  document.getElementById('resetBtn').addEventListener('click', resetToInitialState);

  // 搜索按钮
  document.getElementById('searchBtn').addEventListener('click', () => {
    if (searchMode === 'single') {
      performSearch();
    }
  });

  // 变化检测搜索按钮
  const changeSearchBtn = document.getElementById('changeSearchBtn');
  if (changeSearchBtn) {
    changeSearchBtn.addEventListener('click', () => {
      performChangeSearch();
    });
  }

  // 滑块事件
  const topNSlider = document.getElementById('topNSlider');
  const topNValue = document.getElementById('topNValue');

  if (topNSlider && topNValue) {
    topNSlider.addEventListener('input', () => {
      const value = topNSlider.value;
      topNValue.textContent = value;
    });
  }

  // 地图点击事件
  map.on('click', (e) => {
    if (!isDrawing) return;
    const d = e?.originalEvent?.detail || 1;
    if (d >= 2) return;
    addDrawingPoint(e.latlng);
  });

  // 键盘事件
  document.addEventListener('keydown', (e) => {
    if (!isDrawing) return;

    if (e.key === 'Escape') {
      if (searchMode === 'change' && changeSubMode === 'map' && isDrawing) {
        cancelDrawing();
        document.getElementById('drawROIBtn').disabled = false;
        document.getElementById('roiInfo').textContent = '绘制已取消，请重新绘制ROI区域';
      } else {
        cancelDrawing();
      }
      return;
    }

    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
    if (ctrlOrCmd && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      undoLastPoint();
      return;
    }
  });

  // 搜索模式切换
  function setSearchMode(mode) {
    searchMode = mode;

    document.querySelectorAll('.search-mode-tab').forEach(tab => {
      if (tab.dataset.mode === mode) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    if (mode === 'single') {
      document.getElementById('singleSearchGroup').style.display = 'block';
      document.getElementById('changeSearchGroup').style.display = 'none';

      const hasPolygon = selectedPolygon !== null;
      const hasSingleSamples = sampleImages.single.some(img => img.roiPoints);
      document.getElementById('searchBtn').disabled = !(hasPolygon || hasSingleSamples);

    } else if (mode === 'change') {
      document.getElementById('singleSearchGroup').style.display = 'none';
      document.getElementById('changeSearchGroup').style.display = 'block';

      setChangeSubMode(changeSubMode);
      checkChangeDetectionReady();
    }

    document.getElementById('resultList').style.display = 'none';
    document.getElementById('statsPanel').style.display = 'none';
    document.getElementById('changeStatsPanel').style.display = 'none';
    document.getElementById('previewArea').style.display = 'none';
    document.getElementById('changePreviewImages').style.display = 'none';
  }

  function setChangeSubMode(submode) {
    changeSubMode = submode;

    document.querySelectorAll('.change-submode-tab').forEach(tab => {
      if (tab.dataset.submode === submode) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    if (submode === 'map') {
      document.getElementById('changeMapMode').style.display = 'block';
      document.getElementById('changeUploadMode').style.display = 'none';

      if (mapROIPolygon) {
        document.getElementById('clearROIBtn1').disabled = false;
      }
    } else if (submode === 'upload') {
      document.getElementById('changeMapMode').style.display = 'none';
      document.getElementById('changeUploadMode').style.display = 'block';

      // ============ 新增：切换到上传图片模式时加载年份 ============
      populateYearSelectors();
    }
  }

  document.querySelectorAll('.search-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      setSearchMode(tab.dataset.mode);
    });
  });

  document.querySelectorAll('.change-submode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      setChangeSubMode(tab.dataset.submode);
    });
  });
function updateSingleYearDisplay() {
  const yearDisplay = document.getElementById('singleYearDisplay');
  const yearDisplayInline = document.getElementById('singleYearDisplayInline');
  const currentYear = Config.currentYear;

  if (yearDisplay) {
    yearDisplay.textContent = currentYear;
  }
  if (yearDisplayInline) {
    yearDisplayInline.textContent = currentYear;
  }
}
  // 时间轴切换事件
  document.querySelectorAll('.timeline-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const year = btn.dataset.year;
      switchTileLayer(year);
      updateSingleYearDisplay(); // 添加这行
    });
  });




  // 地图ROI功能按钮 - 注意：HTML中ID为clearROIBtn1
  const drawROIBtn = document.getElementById('drawROIBtn');
  if (drawROIBtn) {
    drawROIBtn.addEventListener('click', startMapROIDrawing);
  }

  const clearROIBtn1 = document.getElementById('clearROIBtn1');
  if (clearROIBtn1) {
    clearROIBtn1.addEventListener('click', clearMapROI);
  }


  // 文件上传输入
  document.getElementById('sampleUploadInput').addEventListener('change', async (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;

    let ok = 0;
    for (const f of files) {
      try {
        await addSampleImageFile(f, 'single');
        ok++;
      } catch (error) {
        console.error(error);
        showNotification(`上传失败：${f.name}（${error.message}）`, 'error');
      }
    }
    e.target.value = '';
    if (ok > 0) showNotification(`成功上传 ${ok} 张示例图片`, 'success');
  });

  document.getElementById('beforePhaseUploadInput').addEventListener('change', async (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;

    try {
      await addSampleImageFile(files[0], 'before');
    } catch (error) {
      console.error(error);
      showNotification(`上传失败：${error.message}`, 'error');
    }
    e.target.value = '';
  });

  document.getElementById('afterPhaseUploadInput').addEventListener('change', async (e) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;

    try {
      await addSampleImageFile(files[0], 'after');
    } catch (error) {
      console.error(error);
      showNotification(`上传失败：${error.message}`, 'error');
    }
    e.target.value = '';
  });

  // 样本卡片点击事件
  document.addEventListener('click', (e) => {
    // 单时相样本卡片
    const singleCard = e.target.closest('.sample-card[data-sid]');
    if (singleCard) {
      const sid = singleCard.dataset.sid;
      const phase = singleCard.dataset.phase || 'single';

      const delBtn = e.target.closest('button[data-action="delete"]');
      if (delBtn) {
        e.stopPropagation();
        if (!confirm('确定删除该示例图片？')) return;
        removeSampleImage(sid, phase);
        showNotification('已删除示例图片', 'success');
        return;
      }

      const nameArea = e.target.closest('[data-action="rename"]');
      if (nameArea) {
        e.stopPropagation();
        beginInlineRename(singleCard, sid, phase);
        return;
      }

      openSampleModal(sid, phase);
      return;
    }

    // 变化检测样本卡片
    const phaseCard = e.target.closest('.phase-card[data-sid]');
    if (phaseCard) {
      const sid = phaseCard.dataset.sid;
      const phase = phaseCard.dataset.phase;

      const delBtn = e.target.closest('button[data-action="delete"]');
      if (delBtn) {
        e.stopPropagation();
        if (!confirm('确定删除该示例图片？')) return;
        removeSampleImage(sid, phase);
        showNotification(`已删除${phase === 'before' ? '前' : '后'}时相示例图片`, 'success');
        return;
      }

      const nameArea = e.target.closest('[data-action="rename"]');
      if (nameArea) {
        e.stopPropagation();
        beginInlineRename(phaseCard, sid, phase);
        return;
      }

      openSampleModal(sid, phase);
      return;
    }

    // 上传加号按钮
    const plusCard = e.target.closest('#samplePlusCard');
    if (plusCard) {
      document.getElementById('sampleUploadInput').click();
      return;
    }

    // 注意：HTML中已改为点击区域，这里保持原有的按钮点击处理作为后备
    const beforePlusBtn = e.target.closest('#phaseBeforeAddBtn');
    if (beforePlusBtn) {
      document.getElementById('beforePhaseUploadInput').click();
      return;
    }

    const afterPlusBtn = e.target.closest('#phaseAfterAddBtn');
    if (afterPlusBtn) {
      document.getElementById('afterPhaseUploadInput').click();
      return;
    }
  });
}

function beginInlineRename(cardEl, sid, phase) {
  const nameDiv = cardEl.querySelector('.sample-name, .phase-name');
  if (!nameDiv) return;

  if (nameDiv.querySelector('input')) return;

  let sample = null;
  if (phase === 'single') {
    sample = sampleImages.single.find(x => x.id === sid);
  } else if (phase === 'before') {
    sample = sampleImages.before.find(x => x.id === sid);
  } else if (phase === 'after') {
    sample = sampleImages.after.find(x => x.id === sid);
  }

  if (!sample) return;

  const input = document.createElement('input');
  input.className = 'sample-name-edit';
  input.value = sample.name;

  const originalContent = nameDiv.innerHTML;
  nameDiv.innerHTML = '';
  nameDiv.appendChild(input);
  input.focus();
  input.select();

  const commit = () => {
    const newName = (input.value || '').trim();
    if (newName) renameSampleImage(sid, newName, phase);
    showNotification('已重命名', 'success');
  };

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    }
    if (ev.key === 'Escape') {
      renderSampleCarousels();
    }
  });

  input.addEventListener('blur', () => {
    commit();
  });
}



// 在页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {

  // 默认设置单时相搜索为地图模式
  setSingleSubMode('map');

  // 更新搜索模式切换逻辑
  function setSearchMode(mode) {
    searchMode = mode;

    // 更新选项卡
    document.querySelectorAll('.search-mode-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    if (mode === 'single') {
      document.getElementById('singleSearchGroup').style.display = 'block';
      document.getElementById('changeSearchGroup').style.display = 'none';

      // 根据当前子模式检查搜索按钮状态
      checkSingleSearchReady();

    } else if (mode === 'change') {
      document.getElementById('singleSearchGroup').style.display = 'none';
      document.getElementById('changeSearchGroup').style.display = 'block';

      setChangeSubMode(changeSubMode);
      checkChangeDetectionReady();
    }

    // 隐藏之前的搜索结果
    document.getElementById('resultList').style.display = 'none';
    document.getElementById('statsPanel').style.display = 'none';
    document.getElementById('changeStatsPanel').style.display = 'none';
    document.getElementById('previewArea').style.display = 'none';
    document.getElementById('changePreviewImages').style.display = 'none';
  }
});


// 修复样本选择器交互逻辑
function enhanceSampleSelector() {
  if (!window.sampleSelector) {
    console.warn('sampleSelector未找到');
    return;
  }

  // 保存原始选择函数
  const originalSelectSample = window.sampleSelector.selectSample;

  // 增强选择函数
  window.sampleSelector.selectSample = function(sample) {
    const result = originalSelectSample.call(this, sample);

    // 如果是单时相模式，更新主界面状态
    if (this.currentPhase === 'single') {
      // 构建完整的样本对象
      const enhancedSample = {
        id: sample.id,
        name: sample.name,
        imageUrl: sample.image_url || `/samples/${sample.tag}/${sample.filename}`,
        roiPoints: sample.roi_points || [],
        year: sample.year
      };

      // 更新单时相选择
      selectSingleSample(enhancedSample);

      // 确保搜索按钮状态更新
      setTimeout(() => {
        updateSearchButtonState();
      }, 100);
    }

    return result;
  };

  console.log('样本选择器已增强，支持单时相状态更新');
}

// 在页面加载后调用
document.addEventListener('DOMContentLoaded', function() {
  // 延迟执行以确保sampleSelector已加载
  setTimeout(() => {
    enhanceSampleSelector();

    // 默认设置单时相搜索为地图模式
    setSingleSubMode('map');

    // 初始状态检查
    updateSearchButtonState();
  }, 1000);
});

