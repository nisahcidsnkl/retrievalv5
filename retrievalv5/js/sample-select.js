/**
 * 示例图片选择器模块
 * 用于前后时相及单时相配置选择示例图片
 */

class SampleSelector {
    constructor() {
        this.currentPhase = null; // 'single', 'before', 'after'
        this.currentTag = '';
        this.currentPage = 1;
        this.pageSize = 12;
        this.totalSamples = 0;
        this.selectedSamples = {
            single: null,
            before: null,
            after: null
        };
        this.currentViewingSampleId = null;
        this.init();
    }

    init() {
        console.log('示例图片选择器模块初始化');
        // 延迟绑定事件，确保DOM已加载
        setTimeout(() => {
            this.bindEvents();
            console.log('选择器事件绑定完成');
        }, 500);
    }

    bindEvents() {
        // 单时相加号点击事件
        const phaseSingleAddArea = document.getElementById('phaseSingleAddArea');
        if (phaseSingleAddArea) {
            phaseSingleAddArea.addEventListener('click', () => {
                this.openSelector('single');
            });
        }

        // 前时相加号点击事件
        const phaseBeforeAddArea = document.getElementById('phaseBeforeAddArea');
        if (phaseBeforeAddArea) {
            phaseBeforeAddArea.addEventListener('click', () => {
                this.openSelector('before');
            });
        }

        // 后时相加号点击事件
        const phaseAfterAddArea = document.getElementById('phaseAfterAddArea');
        if (phaseAfterAddArea) {
            phaseAfterAddArea.addEventListener('click', () => {
                this.openSelector('after');
            });
        }

        // 关闭选择器按钮
        const closeBtn = document.getElementById('sampleSelectorCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closeSelector();
            });
        }

        // 点击模态框外部关闭
        const modal = document.getElementById('sampleSelectorModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeSelector();
                }
            });
        }

        // 标签筛选列表点击事件
        const tagList = document.getElementById('selectorTagList');
        if (tagList) {
            tagList.addEventListener('click', (e) => {
                const tagItem = e.target.closest('li');
                if (tagItem && tagItem.dataset.tag !== undefined) {
                    this.currentTag = tagItem.dataset.tag;
                    this.currentPage = 1;

                    // 更新激活状态
                    tagList.querySelectorAll('li').forEach(li => li.classList.remove('active'));
                    tagItem.classList.add('active');

                    // 更新下拉选择器
                    const tagFilter = document.getElementById('selectorTagFilter');
                    if (tagFilter) {
                        tagFilter.value = this.currentTag;
                    }

                    // 加载示例图片
                    this.loadSamples();
                }
            });
        }

        // 下拉标签筛选器变化事件
        const tagFilter = document.getElementById('selectorTagFilter');
        if (tagFilter) {
            tagFilter.addEventListener('change', (e) => {
                this.currentTag = e.target.value;
                this.currentPage = 1;

                // 更新标签列表激活状态
                const tagList = document.getElementById('selectorTagList');
                if (tagList) {
                    tagList.querySelectorAll('li').forEach(li => li.classList.remove('active'));
                    const activeLi = tagList.querySelector(`li[data-tag="${this.currentTag}"]`);
                    if (activeLi) {
                        activeLi.classList.add('active');
                    }
                }

                this.loadSamples();
            });
        }

        // 分页按钮
        const prevBtn = document.getElementById('selectorPrevBtn');
        const nextBtn = document.getElementById('selectorNextBtn');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.loadSamples();
                }
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                const totalPages = Math.ceil(this.totalSamples / this.pageSize);
                if (this.currentPage < totalPages) {
                    this.currentPage++;
                    this.loadSamples();
                }
            });
        }

        // 点击图片查看大图
        document.addEventListener('click', (e) => {
            const selectorItem = e.target.closest('.selector-item');
            if (selectorItem) {
                const sampleId = selectorItem.dataset.id;

                // 如果点击的是对勾，则取消选择
                const checkbox = e.target.closest('.selector-checkbox');
                if (checkbox) {
                    e.stopPropagation();
                    this.toggleSelection(sampleId);
                    return;
                }

                // 否则查看图片详情
                this.viewSample(sampleId);
            }
        });
    }

    async openSelector(phase) {
        this.currentPhase = phase;
        this.currentTag = '';
        this.currentPage = 1;

        // 更新标题
        const phaseLabel = document.getElementById('sampleSelectorPhaseLabel');
        if (phaseLabel) {
            let phaseText = '';
            if (phase === 'single') phaseText = '示例图片';
            else if (phase === 'before') phaseText = '前时相';
            else if (phase === 'after') phaseText = '后时相';
            phaseLabel.textContent = `选择${phaseText}示例图片`;
        }

        // 重置标签筛选器
        const tagFilter = document.getElementById('selectorTagFilter');
        if (tagFilter) {
            tagFilter.value = '';
        }

        // 重置标签列表
        const tagList = document.getElementById('selectorTagList');
        if (tagList) {
            tagList.querySelectorAll('li').forEach(li => li.classList.remove('active'));
            const allTag = tagList.querySelector('li[data-tag=""]');
            if (allTag) {
                allTag.classList.add('active');
            }
        }

        // 显示模态框
        const modal = document.getElementById('sampleSelectorModal');
        modal.style.display = 'flex';

        // 加载标签
        await this.loadTags();

        // 加载示例图片
        await this.loadSamples();

        // 更新选中数量
        this.updateSelectedCount();
    }

    closeSelector() {
        const modal = document.getElementById('sampleSelectorModal');
        modal.style.display = 'none';
        this.currentPhase = null;
    }

    async loadTags() {
        try {
            const response = await fetch(`${Config.serverUrl}/tags`);
            const data = await response.json();

            if (data.status === 'success') {
                this.renderTags(data.tags);
            }
        } catch (error) {
            console.error('加载标签失败:', error);
            this.showMessage('加载标签失败，请检查网络连接', 'error');
        }
    }

    renderTags(tags) {
        // 更新标签列表
        const tagList = document.getElementById('selectorTagList');
        const tagFilter = document.getElementById('selectorTagFilter');

        if (tagList) {
            let html = '<li class="active" data-tag="">全部标签</li>';
            tags.forEach(tag => {
                html += `<li data-tag="${tag}">${tag}</li>`;
            });
            tagList.innerHTML = html;
        }

        // 更新下拉选择器
        if (tagFilter) {
            // 清空除第一个选项外的所有选项
            while (tagFilter.options.length > 1) {
                tagFilter.remove(1);
            }

            // 添加标签选项
            tags.forEach(tag => {
                const option = document.createElement('option');
                option.value = tag;
                option.textContent = tag;
                tagFilter.appendChild(option);
            });
        }
    }

    async loadSamples() {
        try {
            let url = `${Config.serverUrl}/samples`;
            const params = new URLSearchParams();

            if (this.currentTag) {
                params.append('tag', this.currentTag);
            }

            params.append('page', this.currentPage);
            params.append('page_size', this.pageSize);

            url += '?' + params.toString();

            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'success') {
                this.totalSamples = data.total || data.samples.length;
                this.renderSamples(data.samples);
                this.updatePagination();
            }
        } catch (error) {
            console.error('加载示例图片失败:', error);
            this.renderSamples([]);
        }
    }

    renderSamples(samples) {
        const selectorGrid = document.getElementById('selectorGrid');
        const emptyState = selectorGrid.querySelector('.empty-state');

        if (samples.length === 0) {
            if (emptyState) {
                emptyState.style.display = 'flex';
                emptyState.style.flexDirection = 'column';
                emptyState.style.alignItems = 'center';
                emptyState.style.justifyContent = 'center';
                emptyState.style.padding = '40px 20px';
            }

            // 隐藏所有非空状态的项目
            selectorGrid.querySelectorAll('.selector-item').forEach(item => {
                item.style.display = 'none';
            });
            return;
        }

        // 隐藏空状态
        if (emptyState) {
            emptyState.style.display = 'none';
        }

        // 创建或更新图片项
        let html = '';
        samples.forEach(sample => {
            const imageUrl = sample.image_path && sample.image_path.startsWith('http')
                ? sample.image_path
                : `${Config.serverUrl}/examples/${sample.image_path || sample.filename}`;

            // 检查是否已被当前时相选中
            const isSelected = this.selectedSamples[this.currentPhase]?.id === sample.id;

            html += `
                <div class="selector-item ${isSelected ? 'selected' : ''}" data-id="${sample.id}">
                    ${isSelected ? '<div class="selector-checkbox"><i class="fas fa-check"></i></div>' : ''}
                    <img src="${imageUrl}" class="selector-thumbnail" alt="${sample.name}"
                         onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjEyMCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTIwIiBmaWxsPSIjZjBmMmZmIi8+PHRleHQgeD0iNzUiIHk9IjYwIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIGZpbGw9IiM2NjdFZUEiPkltYWdlPC90ZXh0Pjwvc3ZnPg=='">
                    <div class="selector-info">
                        <div class="selector-name">${sample.name}</div>
                        <div class="selector-tag">${sample.tag || '未分类'}</div>
                    </div>
                </div>
            `;
        });

        selectorGrid.innerHTML = html;
    }

    updatePagination() {
        const pagination = document.getElementById('selectorPagination');
        const prevBtn = document.getElementById('selectorPrevBtn');
        const nextBtn = document.getElementById('selectorNextBtn');
        const pageInfo = document.getElementById('selectorPageInfo');

        const totalPages = Math.ceil(this.totalSamples / this.pageSize);

        if (totalPages <= 1) {
            pagination.style.display = 'none';
        } else {
            pagination.style.display = 'flex';
            prevBtn.disabled = this.currentPage === 1;
            nextBtn.disabled = this.currentPage === totalPages;
            pageInfo.textContent = `第 ${this.currentPage} 页 / 共 ${totalPages} 页`;
        }
    }

    async viewSample(sampleId) {
        try {
            const response = await fetch(`${Config.serverUrl}/samples/${sampleId}`);
            const data = await response.json();

            if (data.status === 'success') {
                const sample = data.sample;
                this.currentViewingSampleId = sampleId;

                // 修改图片查看模态框
                const imageModal = document.getElementById('imageViewModal');
                const imageContainer = document.querySelector('.image-view-body .image-container');
                const imageInfo = document.querySelector('.image-view-body .image-info');

                if (!imageContainer || !imageInfo) {
                    console.error('图片查看模态框结构异常');
                    return;
                }

                // 获取图片URL
                const imageUrl = sample.image_path && sample.image_path.startsWith('http')
                    ? sample.image_path
                    : `${Config.serverUrl}/examples/${sample.image_path || sample.filename}`;

                // 更新模态框内容
                document.getElementById('imageViewTitle').textContent = sample.name;

                // 更新图片容器
                imageContainer.innerHTML = `
                    <img id="viewedImage" alt="预览图片">
                    <canvas id="roiOverlayCanvas"></canvas>
                `;

                const img = document.getElementById('viewedImage');
                const canvas = document.getElementById('roiOverlayCanvas');
                const ctx = canvas.getContext('2d');

                // 设置图片加载完成后的回调
                img.onload = () => {
                    // 设置canvas尺寸与图片相同
                    canvas.width = img.naturalWidth || img.width;
                    canvas.height = img.naturalHeight || img.height;

                    // 绘制ROI
                    this.drawROIOnCanvas(canvas, sample.roi_points);
                };

                img.src = imageUrl;

                // 更新图片信息
                imageInfo.innerHTML = `
                    <div class="info-row">
                        <span class="info-label">文件名：</span>
                        <span id="viewedFileName" class="info-value">${sample.name}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">标签：</span>
                        <span id="viewedFileTag" class="info-value">${sample.tag || '未分类'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">上传时间：</span>
                        <span id="viewedFileTime" class="info-value">${new Date(sample.created_at).toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">描述：</span>
                        <span id="viewedFileDescription" class="info-value">${sample.description || '无描述'}</span>
                    </div>
                    <button class="selector-image-select-btn" id="selectSampleBtn">
                        <i class="fas fa-check"></i> 选择该图片
                    </button>
                `;

                // 绑定选择按钮事件
                const selectBtn = document.getElementById('selectSampleBtn');
                if (selectBtn) {
                    selectBtn.onclick = () => {
                        this.selectSample(sample);
                    };
                }

                // 显示图片查看模态框
                imageModal.style.display = 'flex';
            }
        } catch (error) {
            console.error('查看示例图片失败:', error);
            this.showMessage('查看示例图片失败', 'error');
        }
    }

    drawROIOnCanvas(canvas, roiPoints) {
        if (!canvas || !roiPoints || roiPoints.length < 3) {
            return;
        }

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // 清空canvas
        ctx.clearRect(0, 0, width, height);

        // 开始绘制多边形
        ctx.beginPath();
        ctx.moveTo(roiPoints[0].x, roiPoints[0].y);

        for (let i = 1; i < roiPoints.length; i++) {
            ctx.lineTo(roiPoints[i].x, roiPoints[i].y);
        }

        // 闭合多边形
        ctx.closePath();

        // 设置样式
        ctx.fillStyle = 'rgba(102, 126, 234, 0.3)'; // 半透明蓝色填充
        ctx.fill();

        ctx.strokeStyle = '#667eea'; // 蓝色边框
        ctx.lineWidth = 2;
        ctx.stroke();

        // 绘制顶点
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 1;

        roiPoints.forEach((point, index) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });
    }

    // sample-select.js - selectSample 方法
selectSample(sample) {
  if (!this.currentPhase) return;

  if (this.currentPhase === 'single') {
    // 构建单时相需要的样本对象，确保包含 imageUrl
    const enhancedSample = {
      id: sample.id,
      name: sample.name,
      imageUrl: sample.image_path && sample.image_path.startsWith('http')
        ? sample.image_path
        : `${Config.serverUrl}/examples/${sample.image_path || sample.filename}`,
      roiPoints: sample.roi_points || [],
      year: sample.year
    };

    // 存储选中状态
    this.selectedSamples.single = enhancedSample;

    // 调用全局函数更新UI
    if (typeof window.selectSingleSample === 'function') {
      window.selectSingleSample(enhancedSample);
    }

    // 关闭模态框
    this.closeSelector();
    this.closeImageView();
  } else {
    // 前后时相处理
    this.selectedSamples[this.currentPhase] = {
      id: sample.id,
      name: sample.name,
      tag: sample.tag,
      imageUrl: sample.image_path && sample.image_path.startsWith('http')
        ? sample.image_path
        : `${Config.serverUrl}/examples/${sample.image_path || sample.filename}`,
      description: sample.description
    };

    // 更新前时相配置区域
    this.updatePhaseArea(this.currentPhase);

    // 关闭图片查看模态框
    this.closeImageView();

    // 关闭选择器模态框
    this.closeSelector();

    // 检查是否两个时相都已配置
    this.checkChangeDetectionReady();
  }

  // 重新加载示例图片以更新选中状态
  this.loadSamples();

  // 更新选中数量
  this.updateSelectedCount();

  // 显示成功消息
  const phaseText = this.currentPhase === 'single' ? '示例' : (this.currentPhase === 'before' ? '前时相' : '后时相');
  this.showMessage(`${phaseText}图片选择成功`, 'success');
}

    toggleSelection(sampleId) {
        if (!this.currentPhase) return;

        if (this.currentPhase === 'single') {
            // 如果点击的是已选中的图片，则取消选择
            if (this.selectedSamples.single?.id === sampleId) {
                this.selectedSamples.single = null;
                if (typeof window.selectSingleSample === 'function') {
                    window.selectSingleSample(null);
                }
                this.loadSamples();
                this.showMessage('示例图片选择已取消', 'info');
            }
        } else {
            // 如果点击的是已选中的图片，则取消选择
            if (this.selectedSamples[this.currentPhase]?.id === sampleId) {
                this.selectedSamples[this.currentPhase] = null;

                // 更新配置区域
                this.updatePhaseArea(this.currentPhase);

                // 重新加载示例图片
                this.loadSamples();

                // 检查变化检测状态
                this.checkChangeDetectionReady();

                // 显示消息
                const phaseText = this.currentPhase === 'before' ? '前时相' : '后时相';
                this.showMessage(`${phaseText}图片选择已取消`, 'info');
            }
        }
    }

    updatePhaseArea(phase) {
        const selectedSample = this.selectedSamples[phase];

        if (phase === 'before') {
            const phaseBeforeAddArea = document.getElementById('phaseBeforeAddArea');
            const phaseBeforeStatus = document.getElementById('beforePhaseStatus');

            if (selectedSample) {
                // 已配置状态
                phaseBeforeStatus.textContent = '已配置';
                phaseBeforeStatus.style.color = '#4CAF50';

                // 显示图片信息
                phaseBeforeAddArea.innerHTML = `
                    <div class="phase-info-area">
                        <div class="phase-info-row">
                            <span class="phase-info-label">图片名称:</span>
                            <span class="phase-info-value">${selectedSample.name}</span>
                        </div>
                        <div class="phase-info-row">
                            <span class="phase-info-label">标签类型:</span>
                            <span class="phase-info-value">${selectedSample.tag || '未分类'}</span>
                        </div>
                        <div class="phase-info-actions">
                            <button class="phase-info-change-btn" id="changeBeforeBtn">
                                <i class="fas fa-edit"></i> 更换图片
                            </button>
                        </div>
                    </div>
                `;

                // 绑定更换按钮事件
                const changeBtn = document.getElementById('changeBeforeBtn');
                if (changeBtn) {
                    changeBtn.addEventListener('click', () => {
                        this.openSelector('before');
                    });
                }
            } else {
                // 未配置状态
                phaseBeforeStatus.textContent = '未配置';
                phaseBeforeStatus.style.color = '#f44336';

                // 显示加号按钮
                phaseBeforeAddArea.innerHTML = `
                    <div style="text-align: center;">
                        <div style="font-size: 24px; color: #667eea; margin-bottom: 5px;">
                            <i class="fas fa-plus"></i>
                        </div>
                        <div style="font-size: 12px; color: #666;">
                            点击添加前时相图片
                        </div>
                    </div>
                `;
            }
        } else if (phase === 'after') {
            const phaseAfterAddArea = document.getElementById('phaseAfterAddArea');
            const phaseAfterStatus = document.getElementById('afterPhaseStatus');

            if (selectedSample) {
                // 已配置状态
                phaseAfterStatus.textContent = '已配置';
                phaseAfterStatus.style.color = '#4CAF50';

                // 显示图片信息
                phaseAfterAddArea.innerHTML = `
                    <div class="phase-info-area">
                        <div class="phase-info-row">
                            <span class="phase-info-label">图片名称:</span>
                            <span class="phase-info-value">${selectedSample.name}</span>
                        </div>
                        <div class="phase-info-row">
                            <span class="phase-info-label">标签类型:</span>
                            <span class="phase-info-value">${selectedSample.tag || '未分类'}</span>
                        </div>
                        <div class="phase-info-actions">
                            <button class="phase-info-change-btn" id="changeAfterBtn">
                                <i class="fas fa-edit"></i> 更换图片
                            </button>
                        </div>
                    </div>
                `;

                // 绑定更换按钮事件
                const changeBtn = document.getElementById('changeAfterBtn');
                if (changeBtn) {
                    changeBtn.addEventListener('click', () => {
                        this.openSelector('after');
                    });
                }
            } else {
                // 未配置状态
                phaseAfterStatus.textContent = '未配置';
                phaseAfterStatus.style.color = '#f44336';

                // 显示加号按钮
                phaseAfterAddArea.innerHTML = `
                    <div style="text-align: center;">
                        <div style="font-size: 24px; color: #667eea; margin-bottom: 5px;">
                            <i class="fas fa-plus"></i>
                        </div>
                        <div style="font-size: 12px; color: #666;">
                            点击添加后时相图片
                        </div>
                    </div>
                `;
            }
        }
    }

    checkChangeDetectionReady() {
        const beforeConfigured = this.selectedSamples.before !== null;
        const afterConfigured = this.selectedSamples.after !== null;
        const changeSearchBtn = document.getElementById('changeSearchBtn');

        if (beforeConfigured && afterConfigured) {
            changeSearchBtn.disabled = false;
        } else {
            changeSearchBtn.disabled = true;
        }
    }

    updateSelectedCount() {
        const selectedCountEl = document.getElementById('selectorSelectedCount');
        if (selectedCountEl) {
            let count = 0;
            if (this.currentPhase === 'single') {
                count = this.selectedSamples.single ? 1 : 0;
            } else {
                count = this.selectedSamples[this.currentPhase] ? 1 : 0;
            }
            selectedCountEl.textContent = count;
        }
    }

    closeImageView() {
        const modal = document.getElementById('imageViewModal');
        modal.style.display = 'none';
        this.currentViewingSampleId = null;
    }

    showMessage(message, type = 'info') {
        if (typeof showNotification === 'function') {
            showNotification(message, type);
        } else {
            alert(message);
        }
    }

    // 获取选中的图片数据（用于变化检测）
    getSelectedSample(phase) {
        return this.selectedSamples[phase];
    }

    // 清空所有选择
    clearSelections() {
        this.selectedSamples = {
            single: null,
            before: null,
            after: null
        };
        this.updatePhaseArea('before');
        this.updatePhaseArea('after');
        this.checkChangeDetectionReady();
    }
}

// 初始化示例图片选择器模块
let sampleSelector = null;
document.addEventListener('DOMContentLoaded', () => {
    sampleSelector = new SampleSelector();
    // 暴露到 window 对象，以便其他模块可以访问
    window.sampleSelector = sampleSelector;
    console.log('示例图片选择器模块已初始化');
});