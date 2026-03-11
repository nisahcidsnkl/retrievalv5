// js/toolbox.js
// 大模型解译工具箱

// 全局变量
let llmDrawing = false;
let llmDrawingLatLngs = [];
let llmTempLine, llmTempPolygon, llmVertexLayer, llmDrawnLayer;
let llmPolygon = null;
let llmMap = null;
let llmGetYear = null;

// 初始化工具箱（作为全局函数）
window.initToolbox = function(map, getCurrentYearFn) {
  console.log('初始化工具箱...');
  llmMap = map;
  llmGetYear = getCurrentYearFn;

  const toolboxToggle = document.getElementById('toolboxToggle');
  const toolboxPanel = document.getElementById('toolboxPanel');
  const llmInterpretBtn = document.getElementById('llmInterpretBtn');
  const llmToolsPanel = document.getElementById('llmToolsPanel');
  const startLLMDrawBtn = document.getElementById('startLLMDrawBtn');
  const clearLLMDrawBtn = document.getElementById('clearLLMDrawBtn');

  if (!toolboxToggle || !toolboxPanel) {
    console.error('工具箱元素未找到');
    return;
  }

  // 工具箱展开/收起
  toolboxToggle.addEventListener('click', () => {
    toolboxPanel.classList.toggle('close');
  });

  // 点击大模型解译，展开绘制工具
  if (llmInterpretBtn) {
    llmInterpretBtn.addEventListener('click', () => {
      console.log('点击大模型解译按钮');
      llmToolsPanel.style.display = 'block';
    });
  }

  if (startLLMDrawBtn) {
    startLLMDrawBtn.addEventListener('click', startLLMDraw);
  }

  if (clearLLMDrawBtn) {
    clearLLMDrawBtn.addEventListener('click', clearLLMDraw);
  }

  // 键盘事件支持撤销和取消
  document.addEventListener('keydown', (e) => {
    if (!llmDrawing) return;
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      if (llmDrawingLatLngs.length > 0) {
        llmDrawingLatLngs.pop();
        updateLLMTempShapes();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearLLMDraw();
    }
  });

  // 关闭弹框
  const closeBtn1 = document.getElementById('llmModalCloseBtn');
  const closeBtn2 = document.getElementById('llmModalCloseBtn2');

  if (closeBtn1) {
    closeBtn1.addEventListener('click', () => {
      document.getElementById('llmModal').style.display = 'none';
    });
  }

  if (closeBtn2) {
    closeBtn2.addEventListener('click', () => {
      document.getElementById('llmModal').style.display = 'none';
    });
  }

  console.log('工具箱初始化完成');
};

// 开始绘制
function startLLMDraw() {
  console.log('开始绘制解译多边形');
  if (!llmMap) {
    console.error('地图对象未初始化');
    return;
  }

  clearLLMDraw();
  llmDrawing = true;
  llmDrawingLatLngs = [];

  llmMap.doubleClickZoom.disable();

  // 先移除之前可能存在的监听器
  llmMap.off('dblclick', finishLLMDraw);
  llmMap.off('click', addLLMDrawingPoint);

  // 添加新的监听器
  llmMap.on('dblclick', finishLLMDraw);
  llmMap.on('click', addLLMDrawingPoint);

  // 创建临时图层
  llmTempLine = L.polyline([], { color: '#ff4444', weight: 3, dashArray: '6 6' }).addTo(llmMap);
  llmTempPolygon = L.polygon([], { color: '#ff4444', weight: 2, fillColor: '#ff4444', fillOpacity: 0.1 }).addTo(llmMap);
  llmVertexLayer = L.layerGroup().addTo(llmMap);

  const startBtn = document.getElementById('startLLMDrawBtn');
  const clearBtn = document.getElementById('clearLLMDrawBtn');
  const roiInfo = document.getElementById('llmRoiInfo');

  if (startBtn) startBtn.disabled = true;
  if (clearBtn) clearBtn.disabled = false;
  if (roiInfo) roiInfo.innerHTML = '绘制模式：左键加点，双击结束；Ctrl+Z撤销；Esc取消。';
}

// 添加绘制点
function addLLMDrawingPoint(e) {
  if (!llmDrawing) return;
  console.log('添加绘制点:', e.latlng);
  llmDrawingLatLngs.push(e.latlng);
  updateLLMTempShapes();
}

// 更新临时图形
function updateLLMTempShapes() {
  if (!llmTempLine || !llmTempPolygon) return;
  llmTempLine.setLatLngs(llmDrawingLatLngs);
  if (llmDrawingLatLngs.length >= 3) {
    llmTempPolygon.setLatLngs(llmDrawingLatLngs);
  } else {
    llmTempPolygon.setLatLngs([]);
  }
  refreshLLMVertices();
}

// 刷新顶点标记
function refreshLLMVertices() {
  llmVertexLayer.clearLayers();
  llmDrawingLatLngs.forEach((latlng, idx) => {
    L.circleMarker(latlng, {
      radius: idx === llmDrawingLatLngs.length - 1 ? 6 : 5,
      weight: 2,
      color: '#ff4444',
      fillColor: '#ffffff',
      fillOpacity: 0.7
    }).addTo(llmVertexLayer);
  });
}

// 完成绘制
function finishLLMDraw(e) {
  console.log('完成绘制，点数:', llmDrawingLatLngs.length);
  if (!llmDrawing) return;
  if (llmDrawingLatLngs.length < 3) {
    alert('至少需要3个点才能形成多边形');
    return;
  }

  // 阻止事件冒泡和默认行为
  if (e && e.originalEvent) {
    L.DomEvent.preventDefault(e.originalEvent);
    L.DomEvent.stopPropagation(e.originalEvent);
  }

  llmDrawing = false;
  llmMap.off('click', addLLMDrawingPoint);
  llmMap.off('dblclick', finishLLMDraw);
  llmMap.doubleClickZoom.enable();

  // 移除临时图层
  if (llmTempLine) llmMap.removeLayer(llmTempLine);
  if (llmTempPolygon) llmMap.removeLayer(llmTempPolygon);
  if (llmVertexLayer) llmMap.removeLayer(llmVertexLayer);
  llmTempLine = llmTempPolygon = llmVertexLayer = null;

  // 添加最终多边形（红色无填充）
  llmPolygon = L.polygon(llmDrawingLatLngs, {
    color: '#ff4444',
    weight: 3,
    fill: false
  }).addTo(llmMap);
  llmDrawnLayer = llmPolygon;

  const startBtn = document.getElementById('startLLMDrawBtn');
  const clearBtn = document.getElementById('clearLLMDrawBtn');
  const roiInfo = document.getElementById('llmRoiInfo');

  if (startBtn) startBtn.disabled = false;
  if (clearBtn) clearBtn.disabled = false;
  if (roiInfo) roiInfo.innerHTML = `多边形已绘制，顶点数：${llmDrawingLatLngs.length}`;

  // 自动触发解译
  console.log('触发解译');
  interpretWithLLM(llmDrawingLatLngs);
}

// 清除绘制
function clearLLMDraw() {
  console.log('清除绘制');
  if (llmDrawnLayer && llmMap) llmMap.removeLayer(llmDrawnLayer);
  if (llmTempLine && llmMap) llmMap.removeLayer(llmTempLine);
  if (llmTempPolygon && llmMap) llmMap.removeLayer(llmTempPolygon);
  if (llmVertexLayer && llmMap) llmMap.removeLayer(llmVertexLayer);
  llmDrawing = false;
  llmDrawingLatLngs = [];
  llmPolygon = null;

  if (llmMap) {
    llmMap.off('click', addLLMDrawingPoint);
    llmMap.off('dblclick', finishLLMDraw);
    llmMap.doubleClickZoom.enable();
  }

  const startBtn = document.getElementById('startLLMDrawBtn');
  const clearBtn = document.getElementById('clearLLMDrawBtn');
  const roiInfo = document.getElementById('llmRoiInfo');

  if (startBtn) startBtn.disabled = false;
  if (clearBtn) clearBtn.disabled = true;
  if (roiInfo) roiInfo.innerHTML = '请先绘制多边形区域。';
}

// 调用大模型
async function interpretWithLLM(polygonLatLngs) {
  console.log('interpretWithLLM 被调用');
  const modal = document.getElementById('llmModal');
  const canvas = document.getElementById('llmCanvas');
  const outputDiv = document.getElementById('llmOutput');

  if (!modal) {
    console.error('弹框元素未找到');
    alert('错误：弹框元素未找到');
    return;
  }

  console.log('显示弹框');
  modal.style.display = 'flex';
  outputDiv.innerHTML = '<div class="llm-output-placeholder">正在获取图像...</div>';

  try {
    // 1. 调用后端接口生成1024x1024截图
    const polygonCoords = polygonLatLngs.map(latlng => [latlng.lat, latlng.lng]);
    const year = llmGetYear ? llmGetYear() : 2025;

    console.log('调用后端接口 /llm_interpret');
    console.log('请求参数:', {
      polygon: polygonCoords,
      zoom: llmMap.getZoom(),
      year: year
    });

    const response = await fetch('/llm_interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        polygon: polygonCoords,
        zoom: llmMap.getZoom(),
        year: year
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`);
    }

    const data = await response.json();
    console.log('后端返回:', data);

    if (data.status !== 'success') {
      throw new Error(data.message || '未知错误');
    }

    // 2. 在canvas上绘制图像和红色多边形
    const img = new Image();
    img.src = 'data:image/png;base64,' + data.image_base64;

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 1024, 1024);
    ctx.drawImage(img, 0, 0, 1024, 1024);

    if (data.polygon_pixels && data.polygon_pixels.length >= 3) {
      console.log('绘制多边形到canvas:', data.polygon_pixels);
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(data.polygon_pixels[0][0], data.polygon_pixels[0][1]);
      for (let i = 1; i < data.polygon_pixels.length; i++) {
        ctx.lineTo(data.polygon_pixels[i][0], data.polygon_pixels[i][1]);
      }
      ctx.closePath();
      ctx.stroke();
    } else {
      console.warn('没有多边形像素坐标数据');
    }

    // 3. 调用大模型（直接使用截图，不再重新编码）
    outputDiv.innerHTML = '<div class="llm-output-placeholder">大模型分析中...</div>';
    await streamLLMInterpretation(data.image_base64, outputDiv);

  } catch (err) {
    console.error('解译失败:', err);
    outputDiv.innerHTML = `<div style="color:red;">解译失败：${err.message}</div>`;
  }
}

// 流式调用大模型
async function streamLLMInterpretation(imageBase64, outputDiv) {
  const prompt = "请分析红色框内遥感图像的地貌种类及周边环境或场景。";
  const url = 'http://192.168.0.117:11434/api/chat'; // 请根据实际Ollama地址修改

  try {
    console.log('调用大模型, URL:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3vl4b:latest',
        messages: [
          {
            role: 'user',
            content: prompt,
            images: [imageBase64]
          }
        ],
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`大模型HTTP错误: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let resultText = '';

    outputDiv.innerHTML = ''; // 清空占位符

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '') continue;
        try {
          const json = JSON.parse(line);
          if (json.message && json.message.content) {
            resultText += json.message.content;
            outputDiv.innerHTML = resultText;
            outputDiv.scrollTop = outputDiv.scrollHeight;
          }
        } catch (e) {
          console.warn('解析流数据失败', line.substring(0, 50));
        }
      }
    }

    console.log('大模型调用完成');
  } catch (error) {
    console.error('大模型调用失败:', error);
    outputDiv.innerHTML = `<div style="color:red;">大模型调用失败：${error.message}</div>`;
  }
}