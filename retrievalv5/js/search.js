// search.js
async function performSearch() {
  if (!selectedPolygon) {
    showNotification('请先绘制搜索区域', 'error');
    return;
  }

  const resultList = document.getElementById('resultList');
  resultList.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;"><i class="fas fa-spinner fa-spin"></i> 正在搜索...</div>';
  resultList.style.display = 'block';

  try {
    showLoadingIndicator(true, '正在搜索并进行聚合分析...');

    const latLngs = selectedPolygon.getLatLngs()[0];
    const polygonCoords = latLngs.map(latlng => [latlng.lat, latlng.lng]);

    // 使用当前选中的年份
    const currentYear = Config.currentYear;

    const generateRes = await fetch(`${Config.serverUrl}/generate_screenshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        polygon: polygonCoords,
        zoom: Config.zoomLevel,
        tile_size: Config.tileSize,
        output_size: Config.tileSize,
        year: currentYear  // 添加年份参数
      })
    });

    if (!generateRes.ok) {
      let errorMsg = '生成截图失败';
      try {
        const errorData = await generateRes.json();
        errorMsg = errorData.detail || errorMsg;
      } catch (e) {
        errorMsg = `HTTP ${generateRes.status}: ${generateRes.statusText}`;
      }
      throw new Error(errorMsg);
    }

    const generateData = await generateRes.json();

    if (generateData.status !== 'success') {
      throw new Error(generateData.message || '截图生成失败');
    }

    if (generateData.image_base64 && generateData.mask_base64) {
      updatePreviewFromBase64(
        generateData.image_base64,
        generateData.mask_base64
      );
    }

    const features = generateData.features;
    if (!features) {
      throw new Error('特征提取失败');
    }

    const topN = parseInt(document.getElementById('topNSlider').value);

    // 搜索时传递年份参数
    const searchResponse = await fetch(`${Config.serverUrl}/search_top_n_target`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        features: features,
        top_n: topN,
        year: currentYear  // 传递当前年份
      })
    });

    if (!searchResponse.ok) {
      let errorMsg = '搜索失败';
      try {
        const errorData = await searchResponse.json();
        errorMsg = errorData.detail || errorMsg;
      } catch (e) {
        errorMsg = `HTTP ${searchResponse.status}: ${searchResponse.statusText}`;
      }
      throw new Error(errorMsg);
    }

    const searchData = await searchResponse.json();

    if (searchData.status !== 'success') {
      throw new Error(searchData.message || '搜索失败');
    }

    renderTargetResults(searchData);
    currentTargets = searchData.targets || [];

    showLoadingIndicator(false);
    showNotification(`搜索完成！(${currentYear}年影像)`, 'success');

  } catch (error) {
    showLoadingIndicator(false);
    resultList.innerHTML = `<div style="text-align: center; padding: 40px; color: #f44336;">
      <i class="fas fa-exclamation-triangle" style="font-size: 24px; margin-bottom: 15px;"></i>
      <div style="font-weight: 600; margin-bottom: 10px;">搜索失败</div>
      <div style="font-size: 14px;">${error.message}</div>
    </div>`;
    console.error('搜索错误:', error);
    showNotification(`搜索失败: ${error.message}`, 'error');

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      showNotification('网络连接失败，请检查后端服务是否启动', 'error');
    }
  }
}

// search.js - 修复年份类型问题

async function performSearchBySampleImage(sampleId) {
  if (!sampleId) {
    showNotification('请先选择示例图片', 'error');
    return;
  }

  // 从配置中获取当前年份
  const year = Config.currentYear;
  if (!year) {
    showNotification('无法获取当前年份', 'error');
    return;
  }

  try {
    showLoadingIndicator(true, '正在搜索...', '后端处理中');

    document.getElementById('initialState').style.display = 'none';
    document.getElementById('controlPanel').style.display = 'block';

    const resultList = document.getElementById('resultList');
    resultList.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;"><i class="fas fa-spinner fa-spin"></i> 正在搜索...</div>';
    resultList.style.display = 'block';

    const topN = parseInt(document.getElementById('topNSlider').value);

    // 使用配置中的当前年份
    const requestBody = {
      sample_id: sampleId,
      year: year,  // 使用 Config.currentYear
      top_n: topN,
      min_similarity: 0.2
    };

    console.log('发送请求到 /search_by_sample_image:', requestBody);

    const response = await fetch(`${Config.serverUrl}/search_by_sample_image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      let errorMsg = '搜索失败';
      let errorDetail = '';

      try {
        const errorData = await response.json();
        console.error('错误响应:', errorData);

        if (errorData.detail) {
          if (Array.isArray(errorData.detail)) {
            errorDetail = errorData.detail.map(err => {
              return `${err.loc.join('.')}: ${err.msg} (${err.type})`;
            }).join('; ');
          } else {
            errorDetail = errorData.detail;
          }
        } else {
          errorDetail = JSON.stringify(errorData);
        }

        errorMsg = `请求错误: ${errorDetail}`;
      } catch (e) {
        errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      }

      throw new Error(errorMsg);
    }

    const data = await response.json();
    console.log('搜索成功:', data);

    if (data.status !== 'success') {
      throw new Error(data.message || '搜索失败');
    }

    // 渲染结果
    renderTargetResults(data);
    currentTargets = data.targets || [];

    showLoadingIndicator(false);
    showNotification(`搜索完成！(${year}年影像)`, 'success');

  } catch (error) {
    showLoadingIndicator(false);
    console.error('搜索失败:', error);
    showNotification(`搜索失败: ${error.message}`, 'error');

    const resultList = document.getElementById('resultList');
    resultList.innerHTML = `<div style="text-align: center; padding: 40px; color: #f44336;">
      <i class="fas fa-exclamation-triangle" style="font-size: 24px; margin-bottom: 15px;"></i>
      <div style="font-weight: 600; margin-bottom: 10px;">搜索失败</div>
      <div style="font-size: 14px;">${error.message}</div>
    </div>`;

    throw error;
  }
}

async function extractFeaturesFromSample(imageDataUrl, maskDataUrl, year) {
  const payload = {
    image_base64: stripDataUrlHeader(imageDataUrl),
    mask_base64: stripDataUrlHeader(maskDataUrl),
    year: year  // 传递年份参数
  };

  const res = await fetch(`${Config.serverUrl}/extract_features`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j.detail || j.message || msg;
    } catch (e) {}
    throw new Error(msg);
  }

  const data = await res.json();
  if (!data || data.status !== 'success' || !data.features) {
    throw new Error(data?.message || '特征提取失败');
  }
  return data;
}
// search.js - 修正的跨时相变化检测函数
async function performChangeSearch() {
  // 获取选中的图片
  const beforeSample = sampleSelector.getSelectedSample('before');
  const afterSample = sampleSelector.getSelectedSample('after');

  if (!beforeSample || !afterSample) {
    showNotification('请先选择前后时相图片', 'error');
    return;
  }

  try {
    showLoadingIndicator(true, '正在进行跨时相变化检测...');

    // 获取年份
    const beforeYear = document.getElementById('beforePhaseYear').value;
    const afterYear = document.getElementById('afterPhaseYear').value;

    if (!beforeYear || !afterYear) {
      showNotification('请选择前后时相的年份', 'error');
      showLoadingIndicator(false);
      return;
    }

    // 清空之前的结果
    const resultList = document.getElementById('resultList');
    resultList.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;"><i class="fas fa-spinner fa-spin"></i> 正在检测变化...</div>';
    resultList.style.display = 'block';

    const topN = parseInt(document.getElementById('topNSlider').value);

    // 调用新的变化检测接口
    const response = await fetch(`${Config.serverUrl}/change_detection_by_samples`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sample_id1: beforeSample.id,  // 前时相样本ID
        sample_id2: afterSample.id,   // 后时相样本ID
        year1: parseInt(beforeYear),  // 前时相年份
        year2: parseInt(afterYear),   // 后时相年份
        top_n: topN,                  // 候选数量
        min_similarity: 0.2        // 最小相似度
      })
    });

    const data = await response.json();

    if (data.status === 'success') {
      // 保存变化检测数据
      changeDetectionData = {
        before: {
          sample: beforeSample,
          year: beforeYear
        },
        after: {
          sample: afterSample,
          year: afterYear
        }
      };

      // 渲染结果
      renderChangeDetectionResults(data);

      showNotification(`变化检测完成！找到${data.total_targets}个变化目标`, 'success');
    } else {
      showNotification(data.message || '变化检测失败', 'error');
    }

    showLoadingIndicator(false);
  } catch (error) {
    console.error('变化检测失败:', error);
    showNotification('变化检测失败: ' + error.message, 'error');
    showLoadingIndicator(false);
  }
}

// 修正的 renderChangeDetectionResults 函数
function renderChangeDetectionResults(data) {
  const statsPanel = document.getElementById('changeStatsPanel');
  const resultList = document.getElementById('resultList');

  // 显示统计面板
  statsPanel.style.display = 'block';

  // 更新统计信息
  if (data.targets && data.targets.length > 0) {
    const targetCount = data.targets.length;
    const totalPatches = data.total_patches || 0;

    // 计算平均值
    const avgSimilarityBefore = data.targets.reduce((sum, t) => sum + (t.similarity_before || 0), 0) / data.targets.length;
    const avgSimilarityAfter = data.targets.reduce((sum, t) => sum + (t.similarity_after || 0), 0) / data.targets.length;
    const avgChangeScore = data.targets.reduce((sum, t) => sum + (t.change_score || 0), 0) / data.targets.length;

    // 更新统计面板
    document.getElementById('phaseBeforeTargetCount').textContent = targetCount;
    document.getElementById('phaseAfterTargetCount').textContent = targetCount;
    document.getElementById('phaseBeforeAvgSimilarity').textContent = `${(avgSimilarityBefore * 100).toFixed(1)}%`;
    document.getElementById('phaseAfterAvgSimilarity').textContent = `${(avgSimilarityAfter * 100).toFixed(1)}%`;
    document.getElementById('changeOverallSimilarity').textContent = `${(avgChangeScore * 100).toFixed(1)}%`;
    document.getElementById('phaseBeforeSimilarity').textContent = `${(avgSimilarityBefore * 100).toFixed(1)}%`;
    document.getElementById('phaseAfterSimilarity').textContent = `${(avgSimilarityAfter * 100).toFixed(1)}%`;
    document.getElementById('phaseBeforePatchCount').textContent = totalPatches;
    document.getElementById('phaseAfterPatchCount').textContent = totalPatches;
  } else {
    // 无结果的情况
    document.getElementById('phaseBeforeTargetCount').textContent = '0';
    document.getElementById('phaseAfterTargetCount').textContent = '0';
  }

  // 显示预览图片区域
  document.getElementById('changePreviewImages').style.display = 'grid';

  // 更新预览图片
  if (changeDetectionData.before && changeDetectionData.before.sample) {
    const beforeImageEl = document.getElementById('changePreviewBeforeImage');
    const afterImageEl = document.getElementById('changePreviewAfterImage');

    beforeImageEl.src = changeDetectionData.before.sample.imageUrl;

    // 如果有后时相图片，也更新
    if (changeDetectionData.after && changeDetectionData.after.sample) {
      afterImageEl.src = changeDetectionData.after.sample.imageUrl;
    }

    // 尝试加载掩码图片
    setTimeout(() => {
      loadMaskImages();
    }, 100);
  }

  // 渲染结果列表
  if (data.targets && data.targets.length > 0) {
    let html = `<div style="margin-bottom: 20px; font-size: 16px; font-weight: 700; color: #333; display: flex; align-items: center;">
      <i class="fas fa-exchange-alt" style="margin-right: 10px; color: #667eea;"></i>
      变化检测结果 (共${data.targets.length}个变化目标)
    </div>`;

    data.targets.slice(0, 50).forEach((target, index) => {
      const changeScore = (target.change_score || 0) * 100;


      // 根据变化分数确定颜色
      const changeScoreColor = changeScore > 70 ? '#4CAF50' : changeScore > 50 ? '#FF9800' : '#F44336';

      // 使用缩略图或占位图
      const thumbnailUrl = target.thumbnail
        ? `data:image/png;base64,${target.thumbnail}`
        : 'https://via.placeholder.com/80x80/cccccc/ffffff?text=变化';

      // 编码几何信息
      const geometryEncoded = encodeURIComponent(JSON.stringify(target.geometry || null));

      html += `
        <div class="result-item target-highlight" 
             data-target-id="${target.target_id || index}"
             data-center="${target.center ? target.center.join(',') : ''}"
             data-bounds="${JSON.stringify(target.bounds || [])}"
             data-geometry="${geometryEncoded}"
             data-target-index="${index}"
             style="animation-delay: ${index * 0.1}s;">
          <div class="thumbnail-container">
            <img class="thumbnail-img" src="${thumbnailUrl}" alt="变化目标${index + 1}">
          </div>
          <div class="result-content">
            <div class="result-header">
              <div class="result-title">
                <i class="fas fa-bullseye"></i> 变化目标 ${index + 1}
                <span class="patch-count">${target.patch_count || 0}个图斑</span>
              </div>
              <div class="similarity-badge" style="background: ${changeScoreColor};">${changeScore.toFixed(1)}%</div>
            </div>
            <div class="result-details">
         
              <div><i class="fas fa-map-marker-alt"></i> 中心位置: ${target.center ? target.center.map(c => Number(c).toFixed(6)).join(', ') : '未计算'}</div>
              <div><i class="fas fa-calendar"></i> 时相: ${changeDetectionData.before?.year || '前'} → ${changeDetectionData.after?.year || '后'}</div>
            </div>
            <div style="margin-top: 12px; font-size: 12px; color: #999; display: flex; justify-content: space-between;">
              <div><i class="fas fa-mouse-pointer"></i> 单击在地图中查看</div>
            </div>
          </div>
        </div>
      `;
    });

    if (data.targets.length > 50) {
      html += `<div style="text-align: center; padding: 15px; color: #666; font-size: 14px;">
        还有 ${data.targets.length - 10} 个变化目标...
      </div>`;
    }

    resultList.innerHTML = html;

    // 绑定点击事件
    bindChangeResultEvents();
  } else {
    resultList.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">' +
      '<i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;"></i>' +
      '<div style="font-weight: 600; margin-bottom: 10px;">未检测到明显变化</div>' +
      '<div style="font-size: 14px;">尝试调整搜索参数或选择不同的示例图片</div>' +
      '</div>';
  }

  resultList.classList.add('fade-in');
}

// 绑定变化检测结果点击事件
function bindChangeResultEvents() {
  document.querySelectorAll('.result-item.target-highlight').forEach((item) => {
    item.addEventListener('click', () => {
      const targetId = item.dataset.targetId;

      if (activeTargetId === targetId) {
        clearAllLayers();
        activeTargetId = null;
        document.querySelectorAll('.result-item').forEach(it => it.classList.remove('active'));
        showNotification(`已取消显示目标 ${targetId}`, 'info');
        return;
      }

      let bounds = [];
      try { bounds = JSON.parse(item.dataset.bounds || '[]'); } catch (e) { bounds = []; }

      let center = null;
      try {
        const c = (item.dataset.center || '').split(',').map(Number);
        if (c.length === 2 && !isNaN(c[0]) && !isNaN(c[1])) center = c;
      } catch (e) { center = null; }

      const geometry = parseGeometryFromDataset(item.dataset.geometry);

      jumpToTarget(targetId, geometry, bounds, center);
    });
  });
}

// 加载掩码图片
async function loadMaskImages() {
  try {
    const beforeSample = changeDetectionData?.before?.sample;
    const afterSample = changeDetectionData?.after?.sample;

    if (beforeSample) {
      // 获取样本标签
      const tagRes = await fetch(`${Config.serverUrl}/samples/${beforeSample.id}/tag`);
      const tagData = await tagRes.json();

      if (tagData.tag) {
        const maskUrl = `${Config.serverUrl}/masks/${tagData.tag}/${beforeSample.id}.png`;
        const beforeMaskEl = document.getElementById('changePreviewBeforeMask');
        beforeMaskEl.src = maskUrl;
      }
    }

    if (afterSample) {
      const tagRes = await fetch(`${Config.serverUrl}/samples/${afterSample.id}/tag`);
      const tagData = await tagRes.json();

      if (tagData.tag) {
        const maskUrl = `${Config.serverUrl}/masks/${tagData.tag}/${afterSample.id}.png`;
        const afterMaskEl = document.getElementById('changePreviewAfterMask');
        afterMaskEl.src = maskUrl;
      }
    }
  } catch (error) {
    console.warn('加载掩码图片失败:', error);
  }
}

function renderTargetResults(searchData) {
  const resultList = document.getElementById('resultList');
  const targets = searchData.targets || [];
  const filteredResults = searchData.filtered_results || [];

  const topN = (typeof searchData.top_n === 'number')
    ? searchData.top_n
    : (filteredResults.length || 100);

  if (targets.length === 0) {
    resultList.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">' +
      '<i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;"></i>' +
      '<div style="font-weight: 600; margin-bottom: 10px;">未找到符合条件的聚合目标</div>' +
      '<div style="font-size: 14px;">尝试增加前N个图斑数量或调整参数</div>' +
      '</div>';
    updateStatsPanel(null);
    clearAllLayers();
    return;
  }

  const similarities = targets.map(t => t.similarity || t.avg_similarity || 0);
  const maxSimilarity = Math.max(...similarities);
  const minSimilarity = Math.min(...similarities);
  const overallSimilarity = targets.length > 0
    ? ((similarities.reduce((sum, s) => sum + s, 0) / targets.length) * 100).toFixed(1) + '%'
    : '0%';

  updateStatsPanel({
    filteredCount: topN,
    targetCount: targets.length,
    maxSimilarity: `${(maxSimilarity * 100).toFixed(1)}%`,
    minSimilarity: `${(minSimilarity * 100).toFixed(1)}%`,
    overallSimilarity: overallSimilarity
  });

  clearAllLayers();

  let html = `<div style="margin-bottom: 20px; font-size: 16px; font-weight: 700; color: #333; display: flex; align-items: center;">
    <i class="fas fa-bullseye" style="margin-right: 10px; color: #ff4444;"></i>
    搜索结果 (前${topN}个图斑，共${targets.length}个目标)
  </div>`;

  targets.sort((a, b) => (b.similarity || b.avg_similarity || 0) - (a.similarity || a.avg_similarity || 0));

  targets.forEach((target, index) => {
    const similarity = target.similarity || target.avg_similarity || 0;
    const similarityPercent = (similarity * 100).toFixed(1);
    const similarityColor = similarity > 0.8 ? '#4CAF50' : similarity > 0.6 ? '#FF9800' : '#F44336';

    const thumbnailUrl = target.thumbnail
      ? `data:image/png;base64,${target.thumbnail}`
      : 'https://via.placeholder.com/80x80/ff4444/ffffff?text=目标';

    const geometryEncoded = encodeURIComponent(JSON.stringify(target.geometry || null));

    html += `
      <div class="result-item target-highlight"
           data-target-id="${target.target_id || target.cluster_id}"
           data-center="${target.center ? target.center.join(',') : ''}"
           data-bounds="${JSON.stringify(target.bounds || [])}"
           data-geometry="${geometryEncoded}"
           data-target-index="${index}"
           style="animation-delay: ${index * 0.1};">
        <div class="thumbnail-container">
          <img class="thumbnail-img" src="${thumbnailUrl}" alt="目标${index + 1}缩略图">
        </div>
        <div class="result-content">
          <div class="result-header">
            <div class="result-title">
              <i class="fas fa-bullseye"></i> 目标 ${index + 1}
              <span class="patch-count">${target.patch_count || 0}个图斑</span>
            </div>
            <div class="similarity-badge" style="background: ${similarityColor};">${similarityPercent}%</div>
          </div>
          <div class="result-details">
            <div><i class="fas fa-th-large"></i> 图斑数量: ${target.patch_count || 0}个</div>
            <div><i class="fas fa-map-marker-alt"></i> 中心位置: ${target.center ? target.center.map(c => Number(c).toFixed(6)).join(', ') : '未计算'}</div>
          </div>
          <div style="margin-top: 12px; font-size: 12px; color: #999; display: flex; justify-content: space-between;">
            <div><i class="fas fa-mouse-pointer"></i> 单击在地图中查看</div>
          </div>
        </div>
      </div>
    `;
  });

  resultList.innerHTML = html;
  resultList.classList.add('fade-in');
  resultList.style.display = 'block';

  document.querySelectorAll('.result-item.target-highlight').forEach((item) => {
    item.addEventListener('click', () => {
      const targetId = item.dataset.targetId;

      if (activeTargetId === targetId) {
        clearAllLayers();
        activeTargetId = null;
        document.querySelectorAll('.result-item').forEach(it => it.classList.remove('active'));
        showNotification(`已取消显示目标 ${targetId}`, 'info');
        return;
      }

      let bounds = [];
      try { bounds = JSON.parse(item.dataset.bounds || '[]'); } catch (e) { bounds = []; }

      let center = null;
      try {
        const c = (item.dataset.center || '').split(',').map(Number);
        if (c.length === 2 && !isNaN(c[0]) && !isNaN(c[1])) center = c;
      } catch (e) { center = null; }

      const geometry = parseGeometryFromDataset(item.dataset.geometry);

      jumpToTarget(targetId, geometry, bounds, center);
    });
  });
}

function jumpToTarget(targetId, geometry, bounds, center) {
  try {
    clearAllLayers();
    activeTargetId = targetId;

    let layer = null;

    if (geometry && geometry.type) {
      layer = L.geoJSON(geometry, {
        style: {
          color: '#ff4444',
          weight: 3,
          fillColor: '#ff4444',
          fillOpacity: 0.05
        },
        interactive: false
      }).addTo(map);

      targetLayers.push(layer);

      const b = layer.getBounds();
      if (b && b.isValid && b.isValid()) {
        map.flyToBounds(b.pad(0.1), {
          animate: true,
          duration: 1.5,
          easeLinearity: 0.25
        });
      } else if (center) {
        map.flyTo(center, Config.zoomLevel, { animate: true, duration: 1.5, easeLinearity: 0.25 });
      }
    } else {
      if (!bounds || bounds.length < 3) {
        if (center) {
          map.flyTo(center, Config.zoomLevel, { animate: true, duration: 1.5, easeLinearity: 0.25 });
        }
      } else {
        const latLngs = bounds.map(coord => L.latLng(coord[0], coord[1]));
        layer = L.polygon(latLngs, {
          color: '#ff4444',
          weight: 3,
          fillColor: '#ff4444',
          fillOpacity: 0.05,
          className: 'target-outline',
          interactive: false
        }).addTo(map);

        targetLayers.push(layer);

        const boundsObj = L.latLngBounds(latLngs);
        map.flyToBounds(boundsObj.pad(0.1), {
          animate: true,
          duration: 1.5,
          easeLinearity: 0.25
        });
      }
    }

    document.querySelectorAll('.result-item').forEach(item => item.classList.remove('active'));
    const targetItem = document.querySelector(`.result-item[data-target-id="${targetId}"]`);
    if (targetItem) {
      targetItem.classList.add('active');
      targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    showNotification(`已定位到目标 ${targetId}，再次点击可取消显示`, 'info');

  } catch (error) {
    console.error('目标定位失败:', error);
    showNotification(`目标定位失败: ${error.message}`, 'error');
  }
}

// 修正的 renderChangeDetectionResults 函数
function renderChangeDetectionResults(data) {
  const statsPanel = document.getElementById('changeStatsPanel');
  const resultList = document.getElementById('resultList');

  // 显示统计面板
  statsPanel.style.display = 'block';

  // 更新统计信息
  if (data.targets && data.targets.length > 0) {
    const targetCount = data.targets.length;
    const totalPatches = data.total_patches || 0;

    // 计算平均值
    const avgSimilarityBefore = data.targets.reduce((sum, t) => sum + (t.similarity_before || 0), 0) / data.targets.length;
    const avgSimilarityAfter = data.targets.reduce((sum, t) => sum + (t.similarity_after || 0), 0) / data.targets.length;
    const avgChangeScore = data.targets.reduce((sum, t) => sum + (t.change_score || 0), 0) / data.targets.length;

    // 更新统计面板
    document.getElementById('phaseBeforeTargetCount').textContent = targetCount;
    document.getElementById('phaseAfterTargetCount').textContent = targetCount;
    document.getElementById('phaseBeforeAvgSimilarity').textContent = `${(avgSimilarityBefore * 100).toFixed(1)}%`;
    document.getElementById('phaseAfterAvgSimilarity').textContent = `${(avgSimilarityAfter * 100).toFixed(1)}%`;
    document.getElementById('changeOverallSimilarity').textContent = `${(avgChangeScore * 100).toFixed(1)}%`;
    document.getElementById('phaseBeforeSimilarity').textContent = `${(avgSimilarityBefore * 100).toFixed(1)}%`;
    document.getElementById('phaseAfterSimilarity').textContent = `${(avgSimilarityAfter * 100).toFixed(1)}%`;
    document.getElementById('phaseBeforePatchCount').textContent = totalPatches;
    document.getElementById('phaseAfterPatchCount').textContent = totalPatches;
  } else {
    // 无结果的情况
    document.getElementById('phaseBeforeTargetCount').textContent = '0';
    document.getElementById('phaseAfterTargetCount').textContent = '0';
  }

  // 显示预览图片区域
  document.getElementById('changePreviewImages').style.display = 'grid';

  // 更新预览图片
  if (changeDetectionData.before && changeDetectionData.before.sample) {
    const beforeImageEl = document.getElementById('changePreviewBeforeImage');
    const afterImageEl = document.getElementById('changePreviewAfterImage');

    beforeImageEl.src = changeDetectionData.before.sample.imageUrl;

    // 如果有后时相图片，也更新
    if (changeDetectionData.after && changeDetectionData.after.sample) {
      afterImageEl.src = changeDetectionData.after.sample.imageUrl;
    }

    // 尝试加载掩码图片
    setTimeout(() => {
      loadMaskImages();
    }, 100);
  }

  // 渲染结果列表
  if (data.targets && data.targets.length > 0) {
    let html = `<div style="margin-bottom: 20px; font-size: 16px; font-weight: 700; color: #333; display: flex; align-items: center;">
      <i class="fas fa-exchange-alt" style="margin-right: 10px; color: #667eea;"></i>
      变化检测结果 (共${data.targets.length}个变化目标)
    </div>`;

    data.targets.slice(0, 50).forEach((target, index) => {
      const changeScore = (target.change_score || 0) * 100;


      // 根据变化分数确定颜色
      const changeScoreColor = changeScore > 70 ? '#4CAF50' : changeScore > 50 ? '#FF9800' : '#F44336';

      // 使用缩略图或占位图
      const thumbnailUrl = target.thumbnail
        ? `data:image/png;base64,${target.thumbnail}`
        : 'https://via.placeholder.com/80x80/cccccc/ffffff?text=变化';

      // 编码几何信息
      const geometryEncoded = encodeURIComponent(JSON.stringify(target.geometry || null));

      html += `
        <div class="result-item target-highlight" 
             data-target-id="${target.target_id || index}"
             data-center="${target.center ? target.center.join(',') : ''}"
             data-bounds="${JSON.stringify(target.bounds || [])}"
             data-geometry="${geometryEncoded}"
             data-target-index="${index}"
             style="animation-delay: ${index * 0.1}s;">
          <div class="thumbnail-container">
            <img class="thumbnail-img" src="${thumbnailUrl}" alt="变化目标${index + 1}">
          </div>
          <div class="result-content">
            <div class="result-header">
              <div class="result-title">
                <i class="fas fa-bullseye"></i> 变化目标 ${index + 1}
                <span class="patch-count">${target.patch_count || 0}个图斑</span>
              </div>
              <div class="similarity-badge" style="background: ${changeScoreColor};">${changeScore.toFixed(1)}%</div>
            </div>
            <div class="result-details">
         
              <div><i class="fas fa-map-marker-alt"></i> 中心位置: ${target.center ? target.center.map(c => Number(c).toFixed(6)).join(', ') : '未计算'}</div>
              <div><i class="fas fa-calendar"></i> 时相: ${changeDetectionData.before?.year || '前'} → ${changeDetectionData.after?.year || '后'}</div>
            </div>
            <div style="margin-top: 12px; font-size: 12px; color: #999; display: flex; justify-content: space-between;">
              <div><i class="fas fa-mouse-pointer"></i> 单击在地图中查看</div>
            </div>
          </div>
        </div>
      `;
    });

    if (data.targets.length > 50) {
      html += `<div style="text-align: center; padding: 15px; color: #666; font-size: 14px;">
        还有 ${data.targets.length - 10} 个变化目标...
      </div>`;
    }

    resultList.innerHTML = html;

    // 绑定点击事件
    bindChangeResultEvents();
  } else {
    resultList.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">' +
      '<i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;"></i>' +
      '<div style="font-weight: 600; margin-bottom: 10px;">未检测到明显变化</div>' +
      '<div style="font-size: 14px;">尝试调整搜索参数或选择不同的示例图片</div>' +
      '</div>';
  }

  resultList.classList.add('fade-in');
}

// 绑定变化检测结果点击事件
function bindChangeResultEvents() {
  document.querySelectorAll('.result-item.target-highlight').forEach((item) => {
    item.addEventListener('click', () => {
      const targetId = item.dataset.targetId;

      if (activeTargetId === targetId) {
        clearAllLayers();
        activeTargetId = null;
        document.querySelectorAll('.result-item').forEach(it => it.classList.remove('active'));
        showNotification(`已取消显示目标 ${targetId}`, 'info');
        return;
      }

      let bounds = [];
      try { bounds = JSON.parse(item.dataset.bounds || '[]'); } catch (e) { bounds = []; }

      let center = null;
      try {
        const c = (item.dataset.center || '').split(',').map(Number);
        if (c.length === 2 && !isNaN(c[0]) && !isNaN(c[1])) center = c;
      } catch (e) { center = null; }

      const geometry = parseGeometryFromDataset(item.dataset.geometry);

      jumpToTarget(targetId, geometry, bounds, center);
    });
  });
}

// 加载掩码图片
async function loadMaskImages() {
  try {
    const beforeSample = changeDetectionData?.before?.sample;
    const afterSample = changeDetectionData?.after?.sample;

    if (beforeSample) {
      // 获取样本标签
      const tagRes = await fetch(`${Config.serverUrl}/samples/${beforeSample.id}/tag`);
      const tagData = await tagRes.json();

      if (tagData.tag) {
        const maskUrl = `${Config.serverUrl}/masks/${tagData.tag}/${beforeSample.id}.png`;
        const beforeMaskEl = document.getElementById('changePreviewBeforeMask');
        beforeMaskEl.src = maskUrl;
      }
    }

    if (afterSample) {
      const tagRes = await fetch(`${Config.serverUrl}/samples/${afterSample.id}/tag`);
      const tagData = await tagRes.json();

      if (tagData.tag) {
        const maskUrl = `${Config.serverUrl}/masks/${tagData.tag}/${afterSample.id}.png`;
        const afterMaskEl = document.getElementById('changePreviewAfterMask');
        afterMaskEl.src = maskUrl;
      }
    }
  } catch (error) {
    console.warn('加载掩码图片失败:', error);
  }
}

function renderTargetResults(searchData) {
  const resultList = document.getElementById('resultList');
  const targets = searchData.targets || [];
  const filteredResults = searchData.filtered_results || [];

  const topN = (typeof searchData.top_n === 'number')
    ? searchData.top_n
    : (filteredResults.length || 100);

  if (targets.length === 0) {
    resultList.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">' +
      '<i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;"></i>' +
      '<div style="font-weight: 600; margin-bottom: 10px;">未找到符合条件的聚合目标</div>' +
      '<div style="font-size: 14px;">尝试增加前N个图斑数量或调整参数</div>' +
      '</div>';
    updateStatsPanel(null);
    clearAllLayers();
    return;
  }

  const similarities = targets.map(t => t.similarity || t.avg_similarity || 0);
  const maxSimilarity = Math.max(...similarities);
  const minSimilarity = Math.min(...similarities);
  const overallSimilarity = targets.length > 0
    ? ((similarities.reduce((sum, s) => sum + s, 0) / targets.length) * 100).toFixed(1) + '%'
    : '0%';

  updateStatsPanel({
    filteredCount: topN,
    targetCount: targets.length,
    maxSimilarity: `${(maxSimilarity * 100).toFixed(1)}%`,
    minSimilarity: `${(minSimilarity * 100).toFixed(1)}%`,
    overallSimilarity: overallSimilarity
  });

  clearAllLayers();

  let html = `<div style="margin-bottom: 20px; font-size: 16px; font-weight: 700; color: #333; display: flex; align-items: center;">
    <i class="fas fa-bullseye" style="margin-right: 10px; color: #ff4444;"></i>
    搜索结果 (前${topN}个图斑，共${targets.length}个目标)
  </div>`;

  targets.sort((a, b) => (b.similarity || b.avg_similarity || 0) - (a.similarity || a.avg_similarity || 0));

  targets.forEach((target, index) => {
    const similarity = target.similarity || target.avg_similarity || 0;
    const similarityPercent = (similarity * 100).toFixed(1);
    const similarityColor = similarity > 0.8 ? '#4CAF50' : similarity > 0.6 ? '#FF9800' : '#F44336';

    const thumbnailUrl = target.thumbnail
      ? `data:image/png;base64,${target.thumbnail}`
      : 'https://via.placeholder.com/80x80/ff4444/ffffff?text=目标';

    const geometryEncoded = encodeURIComponent(JSON.stringify(target.geometry || null));

    html += `
      <div class="result-item target-highlight"
           data-target-id="${target.target_id || target.cluster_id}"
           data-center="${target.center ? target.center.join(',') : ''}"
           data-bounds="${JSON.stringify(target.bounds || [])}"
           data-geometry="${geometryEncoded}"
           data-target-index="${index}"
           style="animation-delay: ${index * 0.1};">
        <div class="thumbnail-container">
          <img class="thumbnail-img" src="${thumbnailUrl}" alt="目标${index + 1}缩略图">
        </div>
        <div class="result-content">
          <div class="result-header">
            <div class="result-title">
              <i class="fas fa-bullseye"></i> 目标 ${index + 1}
              <span class="patch-count">${target.patch_count || 0}个图斑</span>
            </div>
            <div class="similarity-badge" style="background: ${similarityColor};">${similarityPercent}%</div>
          </div>
          <div class="result-details">
            <div><i class="fas fa-th-large"></i> 图斑数量: ${target.patch_count || 0}个</div>
            <div><i class="fas fa-map-marker-alt"></i> 中心位置: ${target.center ? target.center.map(c => Number(c).toFixed(6)).join(', ') : '未计算'}</div>
          </div>
          <div style="margin-top: 12px; font-size: 12px; color: #999; display: flex; justify-content: space-between;">
            <div><i class="fas fa-mouse-pointer"></i> 单击在地图中查看</div>
          </div>
        </div>
      </div>
    `;
  });

  resultList.innerHTML = html;
  resultList.classList.add('fade-in');
  resultList.style.display = 'block';

  document.querySelectorAll('.result-item.target-highlight').forEach((item) => {
    item.addEventListener('click', () => {
      const targetId = item.dataset.targetId;

      if (activeTargetId === targetId) {
        clearAllLayers();
        activeTargetId = null;
        document.querySelectorAll('.result-item').forEach(it => it.classList.remove('active'));
        showNotification(`已取消显示目标 ${targetId}`, 'info');
        return;
      }

      let bounds = [];
      try { bounds = JSON.parse(item.dataset.bounds || '[]'); } catch (e) { bounds = []; }

      let center = null;
      try {
        const c = (item.dataset.center || '').split(',').map(Number);
        if (c.length === 2 && !isNaN(c[0]) && !isNaN(c[1])) center = c;
      } catch (e) { center = null; }

      const geometry = parseGeometryFromDataset(item.dataset.geometry);

      jumpToTarget(targetId, geometry, bounds, center);
    });
  });
}

function jumpToTarget(targetId, geometry, bounds, center) {
  try {
    clearAllLayers();
    activeTargetId = targetId;

    let layer = null;

    if (geometry && geometry.type) {
      layer = L.geoJSON(geometry, {
        style: {
          color: '#ff4444',
          weight: 3,
          fillColor: '#ff4444',
          fillOpacity: 0.05
        },
        interactive: false
      }).addTo(map);

      targetLayers.push(layer);

      const b = layer.getBounds();
      if (b && b.isValid && b.isValid()) {
        map.flyToBounds(b.pad(0.1), {
          animate: true,
          duration: 1.5,
          easeLinearity: 0.25
        });
      } else if (center) {
        map.flyTo(center, Config.zoomLevel, { animate: true, duration: 1.5, easeLinearity: 0.25 });
      }
    } else {
      if (!bounds || bounds.length < 3) {
        if (center) {
          map.flyTo(center, Config.zoomLevel, { animate: true, duration: 1.5, easeLinearity: 0.25 });
        }
      } else {
        const latLngs = bounds.map(coord => L.latLng(coord[0], coord[1]));
        layer = L.polygon(latLngs, {
          color: '#ff4444',
          weight: 3,
          fillColor: '#ff4444',
          fillOpacity: 0.05,
          className: 'target-outline',
          interactive: false
        }).addTo(map);

        targetLayers.push(layer);

        const boundsObj = L.latLngBounds(latLngs);
        map.flyToBounds(boundsObj.pad(0.1), {
          animate: true,
          duration: 1.5,
          easeLinearity: 0.25
        });
      }
    }

    document.querySelectorAll('.result-item').forEach(item => item.classList.remove('active'));
    const targetItem = document.querySelector(`.result-item[data-target-id="${targetId}"]`);
    if (targetItem) {
      targetItem.classList.add('active');
      targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    showNotification(`已定位到目标 ${targetId}，再次点击可取消显示`, 'info');

  } catch (error) {
    console.error('目标定位失败:', error);
    showNotification(`目标定位失败: ${error.message}`, 'error');
  }
}