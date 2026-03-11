// sample-managment.js:示例图片管理模块
class SampleManagement {
    constructor() {
        this.currentTag = '';
        this.currentTab = 'tag-manager';
        this.uploadedFile = null;
        this.roiPoints = [];
        this.isDrawingROI = false;
        this.currentSampleId = null;
        this.roiCtx = null;
        this.handleROIClick = null;
        this.handleROIDblClick = null;
        this.handleROIKeydown = null;
        this.init();
    }

    async init() {
        console.log('示例图片管理模块初始化');
        this.bindEvents();
        await this.loadTags();
        await this.updateStats();
    }

    bindEvents() {
        // 齿轮按钮点击事件
        const gearButton = document.getElementById('gearButton');
        if (gearButton) {
            gearButton.addEventListener('click', () => {
                this.openModal();
            });
        } else {
            console.error('找不到齿轮按钮元素 #gearButton');
        }

        // 关闭模态框按钮
        const closeBtn = document.getElementById('sampleManagementCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closeModal();
            });
        }

        // 点击模态框外部关闭
        const modal = document.getElementById('sampleManagementModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal();
                }
            });
        }

        // 标签页切换
        document.querySelectorAll('.sidebar-list li[data-tab]').forEach(item => {
            item.addEventListener('click', () => {
                const tabId = item.getAttribute('data-tab');
                this.switchTab(tabId);
            });
        });

        // 添加标签按钮
        const addTagBtn = document.getElementById('addTagBtn');
        if (addTagBtn) {
            addTagBtn.addEventListener('click', () => {
                this.addTag();
            });
        }

        // 上传区域点击
        const uploadArea = document.getElementById('uploadDropArea');
        const fileInput = document.getElementById('uploadFileInput');
        if (uploadArea && fileInput) {
            uploadArea.addEventListener('click', () => {
                fileInput.click();
            });

            // 拖拽上传
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('dragover');
            });

            uploadArea.addEventListener('dragleave', () => {
                uploadArea.classList.remove('dragover');
            });

            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    this.handleFileUpload(files[0]);
                }
            });
        }

        // 文件选择变化
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.handleFileUpload(e.target.files[0]);
                }
            });
        }

        // 取消上传按钮
        const cancelUploadBtn = document.getElementById('cancelUploadBtn');
        if (cancelUploadBtn) {
            cancelUploadBtn.addEventListener('click', () => {
                this.resetUpload();
            });
        }

        // 确认上传按钮
        const confirmUploadBtn = document.getElementById('confirmUploadBtn');
        if (confirmUploadBtn) {
            confirmUploadBtn.addEventListener('click', () => {
                this.confirmUpload();
            });
        }

        // 清空ROI按钮
        const clearRoiBtn = document.getElementById('clearRoiBtn');
        if (clearRoiBtn) {
            clearRoiBtn.addEventListener('click', () => {
                this.clearROI();
            });
        }

        // 取消ROI按钮
        const cancelRoiBtn = document.getElementById('cancelRoiBtn');
        if (cancelRoiBtn) {
            cancelRoiBtn.addEventListener('click', () => {
                this.cancelROI();
            });
        }

        // 标签筛选
        const browseTagFilter = document.getElementById('browseTagFilter');
        if (browseTagFilter) {
            browseTagFilter.addEventListener('change', (e) => {
                this.currentTag = e.target.value;
                this.loadSamples();
            });
        }

        // 刷新按钮
        const refreshSamplesBtn = document.getElementById('refreshSamplesBtn');
        if (refreshSamplesBtn) {
            refreshSamplesBtn.addEventListener('click', () => {
                this.loadSamples();
            });
        }

        // 关闭图片查看模态框
        const imageViewCloseBtn = document.getElementById('imageViewCloseBtn');
        if (imageViewCloseBtn) {
            imageViewCloseBtn.addEventListener('click', () => {
                this.closeImageView();
            });
        }

        // 删除图片按钮
        const deleteSampleBtn = document.getElementById('deleteSampleBtn');
        if (deleteSampleBtn) {
            deleteSampleBtn.addEventListener('click', () => {
                this.deleteCurrentSample();
            });
        }
    }

    openModal() {
        console.log('打开示例图片管理模态框');
        const modal = document.getElementById('sampleManagementModal');
        if (modal) {
            modal.style.display = 'flex';
            // 刷新数据
            this.loadTags();
            this.updateStats();
            if (this.currentTab === 'sample-browser') {
                this.loadSamples();
            }
        }
    }

    closeModal() {
        const modal = document.getElementById('sampleManagementModal');
        if (modal) {
            modal.style.display = 'none';
            this.resetUpload();
        }
    }

    switchTab(tabId) {
        console.log('切换到标签页:', tabId);
        this.currentTab = tabId;

        // 更新侧边栏激活状态
        document.querySelectorAll('.sidebar-list li').forEach(item => {
            if (item.getAttribute('data-tab') === tabId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // 更新内容区域
        document.querySelectorAll('.tab-content').forEach(content => {
            if (content.id === tabId) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });

        // 如果是浏览标签页，加载示例图片
        if (tabId === 'sample-browser') {
            this.loadSamples();
        }

        // 如果是上传标签页，重置上传状态
        if (tabId === 'upload-manager') {
            this.resetUpload();
        }
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
        const tagListContainer = document.getElementById('tagListContainer');
        if (tagListContainer) {
            if (tags.length === 0) {
                tagListContainer.innerHTML = `
                    <div style="text-align: center; padding: 30px; color: #999;">
                        <i class="fas fa-tags" style="font-size: 32px; margin-bottom: 10px;"></i>
                        <div>暂无标签</div>
                    </div>
                `;
                return;
            }

            let html = '';
            tags.forEach(tag => {
                html += `
                    <div class="tag-item">
                        <span class="tag-name">${tag}</span>
                        <span class="tag-count">0</span>
                        <div class="tag-actions">
                            <button class="tag-action-btn" data-tag="${tag}" data-action="delete" title="删除标签">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
            tagListContainer.innerHTML = html;

            // 绑定删除事件
            tagListContainer.querySelectorAll('[data-action="delete"]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const tag = btn.dataset.tag;
                    this.deleteTag(tag);
                });
            });
        }

        // 更新标签筛选列表
        const tagFilterList = document.getElementById('tagFilterList');
        const browseTagFilter = document.getElementById('browseTagFilter');
        const sampleTagSelect = document.getElementById('sampleTagSelect');

        if (tagFilterList) {
            let filterHtml = '<li data-tag="">所有标签</li>';
            tags.forEach(tag => {
                filterHtml += `<li data-tag="${tag}">${tag}</li>`;
            });
            tagFilterList.innerHTML = filterHtml;

            // 绑定筛选事件
            tagFilterList.querySelectorAll('li').forEach(item => {
                item.addEventListener('click', () => {
                    const tag = item.getAttribute('data-tag');
                    this.currentTag = tag;

                    // 更新激活状态
                    tagFilterList.querySelectorAll('li').forEach(li => li.classList.remove('active'));
                    item.classList.add('active');

                    // 如果当前在浏览标签页，重新加载示例图片
                    if (this.currentTab === 'sample-browser') {
                        this.loadSamples();
                    }
                });
            });
        }

        // 更新下拉选择器
        const updateSelect = (selectElement) => {
            if (selectElement) {
                // 清空除第一个选项外的所有选项
                while (selectElement.options.length > 1) {
                    selectElement.remove(1);
                }

                // 添加标签选项
                tags.forEach(tag => {
                    const option = document.createElement('option');
                    option.value = tag;
                    option.textContent = tag;
                    selectElement.appendChild(option);
                });
            }
        };

        updateSelect(browseTagFilter);
        updateSelect(sampleTagSelect);
    }

    async addTag() {
        const tagInput = document.getElementById('newTagInput');
        const tagName = tagInput.value.trim();

        if (!tagName) {
            this.showMessage('请输入标签名称', 'error');
            return;
        }

        try {
            const response = await fetch(`${Config.serverUrl}/tags`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: tagName })
            });

            const data = await response.json();

            if (data.status === 'success') {
                this.showMessage('标签创建成功', 'success');
                tagInput.value = '';
                await this.loadTags();
            } else {
                this.showMessage(data.message || '创建标签失败', 'error');
            }
        } catch (error) {
            console.error('创建标签失败:', error);
            this.showMessage('创建标签失败，请检查网络连接', 'error');
        }
    }

    async deleteTag(tagName) {
        if (!confirm(`确定要删除标签"${tagName}"吗？这会删除该标签下的所有示例图片！`)) {
            return;
        }

        try {
            const response = await fetch(`${Config.serverUrl}/tags/${encodeURIComponent(tagName)}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.status === 'success') {
                this.showMessage('标签删除成功', 'success');
                await this.loadTags();
                if (this.currentTab === 'sample-browser') {
                    await this.loadSamples();
                }
                await this.updateStats();
            } else {
                this.showMessage(data.message || '删除标签失败', 'error');
            }
        } catch (error) {
            console.error('删除标签失败:', error);
            this.showMessage('删除标签失败，请检查网络连接', 'error');
        }
    }

    handleFileUpload(file) {
        // 验证文件类型
        if (!file.type.startsWith('image/')) {
            this.showMessage('请选择图片文件', 'error');
            return;
        }

        this.uploadedFile = file;
        this.showUploadPreview(file);
    }

    showUploadPreview(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const previewContainer = document.getElementById('uploadPreviewContainer');
            const uploadArea = document.getElementById('uploadDropArea');
            const uploadPreview = document.getElementById('uploadPreview');
            const roiCanvasContainer = document.getElementById('roiCanvasContainer');
            const roiInstructions = document.getElementById('roiInstructions');
            const uploadForm = document.getElementById('uploadForm');

            if (previewContainer) previewContainer.style.display = 'block';
            if (uploadArea) uploadArea.style.display = 'none';

            // 显示预览
            if (uploadPreview) {
                uploadPreview.innerHTML = `
                    <img src="${e.target.result}" class="preview-image" alt="预览">
                    <div class="preview-info">
                        <div class="preview-name">${file.name}</div>
                        <div class="preview-details">
                            大小: ${this.formatFileSize(file.size)}<br>
                            类型: ${file.type}
                        </div>
                        <button class="btn btn-primary" id="startRoiBtn">
                            <i class="fas fa-draw-polygon"></i> 开始绘制ROI区域
                        </button>
                    </div>
                `;

                // 绑定开始绘制ROI按钮
                const startRoiBtn = document.getElementById('startRoiBtn');
                if (startRoiBtn) {
                    startRoiBtn.addEventListener('click', () => {
                        this.startROIDrawing(e.target.result);
                    });
                }
            }

            // 设置默认名称（去掉扩展名）
            const nameInput = document.getElementById('sampleNameInput');
            if (nameInput) {
                const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
                nameInput.value = nameWithoutExt;
            }

            // 显示ROI绘制区域和表单
            setTimeout(() => {
                if (roiCanvasContainer) roiCanvasContainer.style.display = 'block';
                if (roiInstructions) roiInstructions.style.display = 'block';
                if (uploadForm) uploadForm.style.display = 'block';

                // 初始化ROI绘制
                this.initROIDrawing(e.target.result);
            }, 100);
        };
        reader.readAsDataURL(file);
    }

    initROIDrawing(imageSrc) {
        const roiImage = document.getElementById('roiPreviewImage');
        const roiCanvas = document.getElementById('roiDrawingCanvas');

        if (!roiImage || !roiCanvas) return;

        roiImage.src = imageSrc;

        roiImage.onload = () => {
            const container = document.getElementById('roiCanvasContainer');
            if (!container) return;

            const width = container.clientWidth;
            const height = container.clientHeight;

            roiCanvas.width = width;
            roiCanvas.height = height;

            const ctx = roiCanvas.getContext('2d');
            this.roiCtx = ctx;

            // 绘制初始图像
            this.drawROI();

            // 绑定绘制事件
            this.bindROIEvents();
        };
    }

    startROIDrawing(imageSrc) {
        this.isDrawingROI = true;
        this.roiPoints = [];
        this.showMessage('请在图片上绘制多边形ROI区域，双击完成绘制', 'info');

        // 重新初始化ROI绘制
        this.initROIDrawing(imageSrc);
    }

    bindROIEvents() {
        const roiCanvas = document.getElementById('roiDrawingCanvas');
        if (!roiCanvas) return;

        // 移除旧的事件监听器
        roiCanvas.removeEventListener('click', this.handleROIClick);
        roiCanvas.removeEventListener('dblclick', this.handleROIDblClick);

        // 添加新的事件监听器
        this.handleROIClick = (e) => {
            if (!this.isDrawingROI) return;

            const rect = roiCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            this.roiPoints.push({ x, y });
            this.drawROI();

            // 启用上传按钮（至少有3个点）
            const confirmUploadBtn = document.getElementById('confirmUploadBtn');
            if (confirmUploadBtn) {
                confirmUploadBtn.disabled = this.roiPoints.length < 3;
            }
        };

        this.handleROIDblClick = (e) => {
            e.preventDefault();
            if (this.roiPoints.length >= 3) {
                this.isDrawingROI = false;
                this.drawROI();
                this.showMessage('ROI绘制完成，可以上传图片了', 'success');
            }
        };

        roiCanvas.addEventListener('click', this.handleROIClick);
        roiCanvas.addEventListener('dblclick', this.handleROIDblClick);

        // 键盘事件
        document.addEventListener('keydown', this.handleROIKeydown = (e) => {
            if (e.key === 'Escape') {
                this.cancelROI();
            }
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                if (this.roiPoints.length > 0) {
                    this.roiPoints.pop();
                    this.drawROI();

                    const confirmUploadBtn = document.getElementById('confirmUploadBtn');
                    if (confirmUploadBtn) {
                        confirmUploadBtn.disabled = this.roiPoints.length < 3;
                    }
                }
            }
        });
    }

    drawROI() {
        if (!this.roiCtx) return;

        const roiCanvas = document.getElementById('roiDrawingCanvas');
        if (!roiCanvas) return;

        const ctx = this.roiCtx;
        const width = roiCanvas.width;
        const height = roiCanvas.height;

        // 清空画布
        ctx.clearRect(0, 0, width, height);

        if (this.roiPoints.length === 0) return;

        // 绘制多边形
        ctx.beginPath();
        ctx.moveTo(this.roiPoints[0].x, this.roiPoints[0].y);

        for (let i = 1; i < this.roiPoints.length; i++) {
            ctx.lineTo(this.roiPoints[i].x, this.roiPoints[i].y);
        }

        // 如果绘制完成，闭合多边形并填充
        if (!this.isDrawingROI && this.roiPoints.length >= 3) {
            ctx.closePath();
            ctx.fillStyle = 'rgba(102, 126, 234, 0.3)';
            ctx.fill();
        }

        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 3;
        ctx.setLineDash(this.isDrawingROI ? [5, 5] : []);
        ctx.stroke();

        // 绘制顶点
        this.roiPoints.forEach((point, i) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, i === this.roiPoints.length - 1 && this.isDrawingROI ? 6 : 5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#667eea';
            ctx.lineWidth = 2;
            ctx.stroke();
        });
    }

    clearROI() {
        this.roiPoints = [];
        this.isDrawingROI = true;
        this.drawROI();

        const confirmUploadBtn = document.getElementById('confirmUploadBtn');
        if (confirmUploadBtn) {
            confirmUploadBtn.disabled = true;
        }
    }

    cancelROI() {
        this.roiPoints = [];
        this.isDrawingROI = false;
        this.drawROI();

        // 隐藏ROI相关元素
        const roiCanvasContainer = document.getElementById('roiCanvasContainer');
        const roiInstructions = document.getElementById('roiInstructions');
        const uploadForm = document.getElementById('uploadForm');

        if (roiCanvasContainer) roiCanvasContainer.style.display = 'none';
        if (roiInstructions) roiInstructions.style.display = 'none';
        if (uploadForm) uploadForm.style.display = 'none';
    }

    async confirmUpload() {
        const sampleName = document.getElementById('sampleNameInput').value.trim();
        const tagName = document.getElementById('sampleTagSelect').value;
        const description = document.getElementById('sampleDescription').value.trim();

        if (!sampleName) {
            this.showMessage('请输入图片名称', 'error');
            return;
        }

        if (!tagName) {
            this.showMessage('请选择标签', 'error');
            return;
        }

        if (this.roiPoints.length < 3) {
            this.showMessage('请至少绘制3个点构成多边形ROI区域', 'error');
            return;
        }

        if (!this.uploadedFile) {
            this.showMessage('请先选择图片文件', 'error');
            return;
        }

        try {
            // 将文件转换为base64
            const imageBase64 = await this.fileToBase64(this.uploadedFile);

            // 创建掩码
            const maskBase64 = await this.createMaskFromROI();
            const roiPoints = this.roiPoints.map(p => ({
                           x: Math.round(Number(p.x)),
                           y: Math.round(Number(p.y))
            }));

            // 上传到后端
            const response = await fetch(`${Config.serverUrl}/samples/upload`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: sampleName,
                    tag: tagName,
                    image_base64: imageBase64,
                    mask_base64: maskBase64,
                    roi_points: roiPoints,
                    description: description
                })
            });

            const data = await response.json();

            if (data.status === 'success') {
                this.showMessage('示例图片上传成功', 'success');
                this.resetUpload();

                // 刷新统计数据
                await this.updateStats();

                // 切换到浏览标签页
                this.switchTab('sample-browser');
            } else {
                this.showMessage(data.message || '上传失败', 'error');
            }
        } catch (error) {
            console.error('上传失败:', error);
            this.showMessage('上传失败，请检查网络连接', 'error');
        }
    }

    async fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                // 移除data:image/png;base64,前缀
                const base64 = e.target.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }


    // sample-management.js 文件中的 createMaskFromROI 函数
async createMaskFromROI() {
    return new Promise((resolve, reject) => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // 修复点：创建灰度图像缓冲区
            // 方法1：使用ImageData创建灰度图像
            const imageData = ctx.createImageData(256, 256);
            const data = imageData.data;

            // 填充黑色背景（灰度值0）
            for (let i = 0; i < data.length; i += 4) {
                data[i] = 0;     // R
                data[i + 1] = 0; // G
                data[i + 2] = 0; // B
                data[i + 3] = 255; // A (不透明)
            }

            ctx.putImageData(imageData, 0, 0);

            // 绘制ROI区域为白色（灰度值255）
            if (this.roiPoints.length >= 3) {
                const roiCanvas = document.getElementById('roiDrawingCanvas');
                const roiImage = document.getElementById('roiPreviewImage');

                if (!roiCanvas || !roiImage) {
                    throw new Error('ROI元素未找到');
                }

                const container = roiCanvas.parentElement;
                const containerRect = container.getBoundingClientRect();
                const imageRect = roiImage.getBoundingClientRect();

                console.log('坐标映射信息:', {
                    containerRect,
                    imageRect,
                    roiCanvasRect: roiCanvas.getBoundingClientRect()
                });

                const imgDisplayWidth = imageRect.width;
                const imgDisplayHeight = imageRect.height;
                const scaleX = 256 / imgDisplayWidth;
                const scaleY = 256 / imgDisplayHeight;

                // 转换坐标
                const scaledPoints = this.roiPoints.map(p => ({
                    x: Math.max(0, Math.min(255, Math.round(p.x * scaleX))),
                    y: Math.max(0, Math.min(255, Math.round(p.y * scaleY)))
                }));

                console.log('转换后的坐标:', scaledPoints);

                // 创建白色填充（灰度值255）
                ctx.fillStyle = '#ffffff'; // 白色
                ctx.beginPath();
                ctx.moveTo(scaledPoints[0].x, scaledPoints[0].y);
                for (let i = 1; i < scaledPoints.length; i++) {
                    ctx.lineTo(scaledPoints[i].x, scaledPoints[i].y);
                }
                ctx.closePath();
                ctx.fill();

                // 可选：绘制边框用于调试（灰度值128）
                ctx.strokeStyle = '#808080'; // 灰色
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // 生成base64 - 注意：这里应该生成PNG格式
            const dataUrl = canvas.toDataURL('image/png');
            const base64 = dataUrl.split(',')[1];
            resolve(base64);

        } catch (error) {
            console.error('创建掩码失败:', error);
            reject(error);
        }
    });
}

    resetUpload() {
        const uploadArea = document.getElementById('uploadDropArea');
        const previewContainer = document.getElementById('uploadPreviewContainer');
        const fileInput = document.getElementById('uploadFileInput');

        if (uploadArea) uploadArea.style.display = 'block';
        if (previewContainer) previewContainer.style.display = 'none';
        if (fileInput) fileInput.value = '';

        this.uploadedFile = null;
        this.roiPoints = [];
        this.isDrawingROI = false;

        // 清理事件监听器
        const roiCanvas = document.getElementById('roiDrawingCanvas');
        if (roiCanvas) {
            roiCanvas.removeEventListener('click', this.handleROIClick);
            roiCanvas.removeEventListener('dblclick', this.handleROIDblClick);
        }

        if (this.handleROIKeydown) {
            document.removeEventListener('keydown', this.handleROIKeydown);
        }
    }

    async loadSamples() {
        try {
            const url = this.currentTag
                ? `${Config.serverUrl}/samples/tag/${encodeURIComponent(this.currentTag)}`
                : `${Config.serverUrl}/samples`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'success') {
                this.renderSamples(data.samples);
            }
        } catch (error) {
            console.error('加载示例图片失败:', error);
            this.renderSamples([]);
        }
    }

    renderSamples(samples) {
        const sampleGrid = document.getElementById('sampleGrid');
        const totalSamplesCount = document.getElementById('totalSamplesCount');

        if (totalSamplesCount) {
            totalSamplesCount.textContent = samples.length;
        }

        if (samples.length === 0) {
            sampleGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-image"></i>
                    <div>暂无示例图片</div>
                    <div style="font-size: 14px; margin-top: 10px;">${this.currentTag ? '该标签下暂无示例图片' : '请先上传示例图片或选择其他标签'}</div>
                </div>
            `;
            return;
        }

        let html = '';
        samples.forEach(sample => {
            const imageUrl = sample.image_path && sample.image_path.startsWith('http')
                ? sample.image_path
                : `${Config.serverUrl}/examples/${sample.image_path || sample.filename}`;

            html += `
                <div class="sample-item" data-id="${sample.id}">
                    <img src="${imageUrl}" class="sample-thumbnail" alt="${sample.name}"
                         onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjEyMCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTIwIiBmaWxsPSIjZjBmMmZmIi8+PHRleHQgeD0iNzUiIHk9IjYwIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIGZpbGw9IiM2NjdFZUEiPkltYWdlPC90ZXh0Pjwvc3ZnPg=='">
                    <div class="sample-info">
                        <div class="sample-name">${sample.name}</div>
                        <div class="sample-tag">${sample.tag || '未分类'}</div>
                    </div>
                    <div class="sample-actions">
                        <button class="sample-action-btn" data-action="view" title="查看">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="sample-action-btn" data-action="delete" title="删除">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        sampleGrid.innerHTML = html;

        // 绑定事件
        this.bindSampleEvents();
    }

    bindSampleEvents() {
        // 查看按钮
        document.querySelectorAll('.sample-action-btn[data-action="view"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sampleItem = e.target.closest('.sample-item');
                const sampleId = sampleItem.getAttribute('data-id');
                this.viewSample(sampleId);
            });
        });

        // 删除按钮
        document.querySelectorAll('.sample-action-btn[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sampleItem = e.target.closest('.sample-item');
                const sampleId = sampleItem.getAttribute('data-id');
                this.deleteSample(sampleId);
            });
        });

        // 点击缩略图查看
        document.querySelectorAll('.sample-thumbnail').forEach(img => {
            img.addEventListener('click', (e) => {
                const sampleItem = e.target.closest('.sample-item');
                const sampleId = sampleItem.getAttribute('data-id');
                this.viewSample(sampleId);
            });
        });
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

    // 绘制顶点（可选）
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

    async viewSample(sampleId) {
    try {
        const response = await fetch(`${Config.serverUrl}/samples/${sampleId}`);
        const data = await response.json();

        if (data.status === 'success') {
            const sample = data.sample;
            this.currentSampleId = sampleId;

            const modal = document.getElementById('imageViewModal');
            const imageContainer = document.getElementById('imageContainer');
            const imageUrl = sample.image_path && sample.image_path.startsWith('http')
                ? sample.image_path
                : `${Config.serverUrl}/examples/${sample.image_path || sample.filename}`;

            // 清空并重新构建图片容器
            if (!imageContainer) {
                // 如果容器不存在，创建新的结构
                const imageViewBody = document.querySelector('.image-view-body');
                imageViewBody.innerHTML = `
                    <div class="image-container" id="imageContainer">
                        <img id="viewedImage" alt="预览图片">
                        <canvas id="roiOverlayCanvas"></canvas>
                    </div>
                    <div class="image-info">
                        <div class="info-row">
                            <span class="info-label">文件名：</span>
                            <span id="viewedFileName" class="info-value"></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">标签：</span>
                            <span id="viewedFileTag" class="info-value"></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">上传时间：</span>
                            <span id="viewedFileTime" class="info-value"></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">文件大小：</span>
                            <span id="viewedFileSize" class="info-value"></span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">描述：</span>
                            <span id="viewedFileDescription" class="info-value"></span>
                        </div>
                        <div style="margin-top: 20px;">
                            <button class="btn btn-danger" id="deleteSampleBtn" style="width: 100%;">
                                <i class="fas fa-trash"></i> 删除此图片
                            </button>
                        </div>
                    </div>
                `;
            }

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


            // 设置其他信息
            document.getElementById('imageViewTitle').textContent = sample.name;
            document.getElementById('viewedFileName').textContent = sample.name;
            document.getElementById('viewedFileTag').textContent = sample.tag || '未分类';
            document.getElementById('viewedFileTime').textContent =
                new Date(sample.created_at).toLocaleString();
            document.getElementById('viewedFileSize').textContent =
                sample.size ? this.formatFileSize(sample.size) : '未知';
            document.getElementById('viewedFileDescription').textContent =
                sample.description || '无描述';

            modal.style.display = 'flex';
        }
    } catch (error) {
        console.error('查看示例图片失败:', error);
        this.showMessage('查看示例图片失败', 'error');
    }
}

    closeImageView() {
        const modal = document.getElementById('imageViewModal');
        modal.style.display = 'none';
        this.currentSampleId = null;
    }

    async deleteCurrentSample() {
        if (this.currentSampleId) {
            await this.deleteSample(this.currentSampleId);
        }
    }

    async deleteSample(sampleId) {
        if (!confirm('确定要删除这个示例图片吗？')) {
            return;
        }

        try {
            const response = await fetch(`${Config.serverUrl}/samples/${sampleId}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.status === 'success') {
                this.showMessage('示例图片删除成功', 'success');
                this.closeImageView();

                // 刷新数据
                await this.updateStats();
                await this.loadSamples();
            } else {
                this.showMessage(data.message || '删除失败', 'error');
            }
        } catch (error) {
            console.error('删除示例图片失败:', error);
            this.showMessage('删除示例图片失败', 'error');
        }
    }

    async updateStats() {
        try {
            const response = await fetch(`${Config.serverUrl}/samples`);
            const data = await response.json();

            if (data.status === 'success') {
                const totalSamplesCount = document.getElementById('totalSamplesCount');
                if (totalSamplesCount) {
                    totalSamplesCount.textContent = data.total || data.count || 0;
                }
            }
        } catch (error) {
            console.error('更新统计信息失败:', error);
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showMessage(message, type = 'info') {
        // 使用现有的showNotification函数
        if (typeof showNotification === 'function') {
            showNotification(message, type);
        } else {
            // 如果showNotification不存在，使用alert
            alert(message);
        }
    }
}

// 初始化示例图片管理模块
let sampleManagement = null;
document.addEventListener('DOMContentLoaded', () => {
    sampleManagement = new SampleManagement();
    console.log('示例图片管理模块已初始化');
});


