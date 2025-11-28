document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('authToken');
    const runCheckBtn = document.getElementById('run-check-btn');
    const message = document.getElementById('message');
    const resultCards = document.querySelectorAll('.result-card');

    const buildHeaders = (baseHeaders = {}, requireAuth = false) => {
        const headers = { ...baseHeaders };
        if (requireAuth && token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    };

    const fetchJson = async (url, options = {}, requireAuth = false) => {
        const response = await fetch(url, {
            credentials: 'same-origin',
            ...options,
            headers: buildHeaders(options.headers, requireAuth)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || `请求 ${url} 失败`);
        }
        return data;
    };

    const showMessage = (text, type = 'info') => {
        if (!message) return;
        message.textContent = text;
        message.className = `message ${type}`;
    };

    const formatFileSize = (size) => {
        if (!size || size <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const index = Math.floor(Math.log(size) / Math.log(1024));
        return `${(size / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
    };

    const updateEmergencyStatusBar = (card, statusPayload) => {
        const bar = card.querySelector('.emergency-status-bar');
        if (!bar) return;

        if (statusPayload?.error) {
            bar.className = 'emergency-status-bar failed';
            bar.innerHTML = `<span class="status-text">状态获取失败：${statusPayload.error}</span>`;
            bar.style.display = 'flex';
            return;
        }

        const { emergency_backup = 'idle', last_error = null } = statusPayload || {};
        let stateClass = 'idle';
        let statusText = '暂无紧急备份请求';

        if (emergency_backup === 'pending') {
            stateClass = 'pending';
            statusText = '已发出紧急备份指令，等待客户端执行';
        } else if (emergency_backup === 'completed') {
            stateClass = 'completed';
            statusText = '最近一次紧急备份已完成';
        }

        if (last_error) {
            stateClass = 'failed';
        }

        bar.className = `emergency-status-bar ${stateClass}`;
        bar.innerHTML = `<span class="status-text">${statusText}</span>`;
        if (last_error) {
            bar.innerHTML += `<span class="error-details">最后错误: ${last_error}</span>`;
        }
        bar.style.display = 'flex';
    };

    const updatePaymentBadge = (card, requiresPayment, dueDate) => {
        const badge = card.querySelector('.payment-badge');
        if (!badge) return;
        if (requiresPayment) {
            badge.textContent = dueDate ? `付费 · ${dueDate}` : '付费 · 未设置';
            badge.style.opacity = 1;
        } else {
            badge.textContent = '免审查客户';
            badge.style.opacity = 0.9;
        }
    };

    const updateEmergencyButton = (card, statusPayload) => {
        const button = card.querySelector('.emergency-trigger-btn');
        if (!button) return;

        const defaultLabel = button.dataset.defaultLabel || '紧急备份';
        button.dataset.defaultLabel = defaultLabel;

        if (statusPayload?.error) {
            button.disabled = false;
            button.classList.remove('waiting');
            button.textContent = defaultLabel;
            button.title = statusPayload.error;
            return;
        }

        const state = statusPayload?.emergency_backup || 'idle';
        const lastError = statusPayload?.last_error;
        if (lastError) {
            button.title = `最后错误：${lastError}`;
        } else {
            button.removeAttribute('title');
        }

        if (state === 'pending') {
            button.disabled = true;
            button.classList.add('waiting');
            button.textContent = '等待客户端...';
            return;
        }

        button.disabled = false;
        button.classList.remove('waiting');
        button.textContent = defaultLabel;
    };

    const renderFileList = (container, files) => {
        if (!files.length) {
            container.innerHTML = '<p class="empty-hint">暂无 .bak 文件</p>';
            return;
        }

        const sortedFiles = [...files].sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
        const list = document.createElement('ul');
        sortedFiles.forEach(file => {
            const listItem = document.createElement('li');
            listItem.className = 'file-entry';

            const fileName = document.createElement('span');
            fileName.className = 'file-name';
            fileName.textContent = file.key?.split('/')?.pop() || file.key;

            const meta = document.createElement('span');
            meta.className = 'file-meta';
            meta.innerHTML = `${file.lastModified || ''}<br>${formatFileSize(file.size)}`;

            listItem.appendChild(fileName);
            listItem.appendChild(meta);
            list.appendChild(listItem);
        });
        container.innerHTML = '';
        container.appendChild(list);
    };

    const loadFileList = async (card, taskId, { autoExpand = false } = {}) => {
        if (!taskId) return;
        const container = card.querySelector('.file-list-container');
        const arrow = card.querySelector('.toggle-arrow');
        if (!container) return;

        if (container.dataset.loaded === 'true' && !autoExpand) {
            return;
        }

        if (autoExpand && arrow) {
            arrow.classList.add('expanded');
        }

        container.style.display = 'block';
        container.dataset.loaded = 'loading';
        container.innerHTML = '<p class="loading-text">文件列表加载中...</p>';

        try {
            const files = await fetchJson(`/api/tasks/${taskId}/files`, {}, true);
            renderFileList(container, files);
            container.dataset.loaded = 'true';
        } catch (error) {
            container.dataset.loaded = 'false';
            container.innerHTML = `<p class="empty-hint">文件加载失败：${error.message}</p>`;
        }
    };

    const loadTaskStatus = async (card) => {
        const taskId = card.dataset.taskId;
        if (!taskId) return;
        try {
            const statusData = await fetchJson(`/api/tasks/${taskId}/status`);
            updateEmergencyStatusBar(card, statusData);
            updateEmergencyButton(card, statusData);
            card.dataset.requiresPayment = statusData.requires_payment;
            card.dataset.paymentDue = statusData.payment_due_date || '';
            updatePaymentBadge(card, statusData.requires_payment, statusData.payment_due_date);

            if (!statusData.requires_payment) {
                await loadFileList(card, taskId, { autoExpand: true });
            }
        } catch (error) {
            updateEmergencyStatusBar(card, { error: error.message });
            updateEmergencyButton(card, { error: error.message });
        }
    };

    const toggleFileList = async (arrow) => {
        const card = arrow.closest('.result-card');
        const container = card?.querySelector('.file-list-container');
        if (!card || !container) return;

        const shouldExpand = !arrow.classList.contains('expanded');
        arrow.classList.toggle('expanded', shouldExpand);
        container.style.display = shouldExpand ? 'block' : 'none';

        if (shouldExpand) {
            await loadFileList(card, card.dataset.taskId);
        }
    };

    const triggerEmergencyBackup = async (button) => {
        const card = button.closest('.result-card');
        const taskId = card?.dataset.taskId;
        const taskName = card?.dataset.taskName || '该任务';
        if (!taskId) return;

        if (!token) {
            showMessage('请先登录后再触发紧急备份。', 'error');
            window.location.href = '/login';
            return;
        }

        if (!confirm(`确定要触发 ${taskName} 的紧急备份吗？`)) {
            return;
        }

        const defaultLabel = button.dataset.defaultLabel || '紧急备份';
        button.disabled = true;
        button.classList.add('waiting');
        button.textContent = '指令发送中...';

        try {
            await fetchJson(`/api/tasks/${taskId}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'pending', reason: 'manual_emergency' })
            }, true);
            showMessage(`已向 ${taskName} 发送紧急备份指令`, 'success');
            await loadTaskStatus(card);
        } catch (error) {
            button.disabled = false;
            button.classList.remove('waiting');
            button.textContent = defaultLabel;
            showMessage(`紧急备份失败：${error.message}`, 'error');
        }
    };

    const bindEmergencyButtons = () => {
        document.querySelectorAll('.emergency-trigger-btn').forEach(button => {
            button.addEventListener('click', () => triggerEmergencyBackup(button));
        });
    };

    const bindCardInteractions = () => {
        document.querySelectorAll('.toggle-arrow').forEach(arrow => {
            arrow.addEventListener('click', () => toggleFileList(arrow));
        });
        bindEmergencyButtons();
        resultCards.forEach(card => loadTaskStatus(card));
    };

    const triggerManualCheck = async () => {
        if (!runCheckBtn) return;
        if (!confirm('您确定要立即执行一次完整的巡检吗？\n这将触发清理旧文件并发送通知。')) {
            return;
        }

        runCheckBtn.disabled = true;
        runCheckBtn.textContent = '正在巡检...';
        showMessage('正在执行巡检，请稍候...', 'info');

        try {
            const result = await fetchJson('/api/run-check', { method: 'POST' }, true);
            showMessage(result.message || '巡检完成', 'success');
            setTimeout(() => window.location.reload(), 1200);
        } catch (error) {
            showMessage(`巡检失败: ${error.message}`, 'error');
        } finally {
            runCheckBtn.disabled = false;
            runCheckBtn.textContent = '立即巡检';
        }
    };

    if (runCheckBtn) {
        runCheckBtn.addEventListener('click', triggerManualCheck);
    }

    bindCardInteractions();
});
