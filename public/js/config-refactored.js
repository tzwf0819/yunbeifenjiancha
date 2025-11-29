document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    const refs = {
        message: document.getElementById('message'),
        taskList: document.getElementById('task-list'),
        saveBtn: document.getElementById('save-config'),
        addTaskBtn: document.getElementById('add-task'),
        obs: {
            bucket: document.getElementById('obs-bucket-name'),
            ak: document.getElementById('obs-ak'),
            sk: document.getElementById('obs-sk'),
            endpoint: document.getElementById('obs-endpoint')
        },
        wechat: {
            corpId: document.getElementById('wechat-corp-id'),
            agentId: document.getElementById('wechat-agent-id'),
            secret: document.getElementById('wechat-secret'),
            touser: document.getElementById('wechat-touser')
        }
    };

    const state = {
        config: null,
        dirty: false,
        statusCache: {}
    };

    const frequencyOptions = ['每日一次', '每日两次', '每日三次', '每小时一次'];

    const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);

    const generateUUID = () => (crypto.randomUUID ? crypto.randomUUID() : `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`);

    const showMessage = (text, type = 'info') => {
        if (!refs.message) return;
        refs.message.textContent = text;
        refs.message.className = `message ${type}`;
    };

    const composeHeaders = (headers = {}) => {
        const finalHeaders = { ...headers };
        if (token) {
            finalHeaders.Authorization = `Bearer ${token}`;
        }
        return finalHeaders;
    };

    const request = async (url, options = {}) => {
        const response = await fetch(url, {
            credentials: 'same-origin',
            ...options,
            headers: composeHeaders({ 'Content-Type': 'application/json', ...(options.headers || {}) })
        });
        let data = null;
        try {
            data = await response.json();
        } catch (error) {
            data = null;
        }
        if (!response.ok) {
            const message = data?.message || `请求失败 (${response.status})`;
            throw new Error(message);
        }
        return data;
    };

    const createEmptyDatabase = () => ({
        prefix: '',
        name: '',
        server: '',
        user: '',
        pass: '',
        times: '',
        backup_frequency: '每日一次',
        retention_count: 3
    });

    const normalizeDatabase = (database = {}) => ({
        ...createEmptyDatabase(),
        ...database,
        retention_count: Number(database.retention_count ?? 3) || 0
    });

    const normalizeTask = (task = {}) => {
        const normalized = {
            id: task.id || generateUUID(),
            name: task.name || '未命名任务',
            folder: task.folder || '',
            remark1: task.remark1 || '',
            remark2: task.remark2 || '',
            requires_payment: Boolean(task.requires_payment),
            payment_due_date: task.payment_due_date || '',
            emergency_backup: task.emergency_backup || 'idle',
            last_error: task.last_error || null,
            last_status_update: task.last_status_update || null,
            databases: Array.isArray(task.databases) && task.databases.length
                ? task.databases.map(normalizeDatabase)
                : [createEmptyDatabase()]
        };
        return normalized;
    };

    const normalizeConfig = (config = {}) => ({
        huawei_obs: {
            ak: config?.huawei_obs?.ak || '',
            sk: config?.huawei_obs?.sk || '',
            endpoint: config?.huawei_obs?.endpoint || '',
            bucket_name: config?.huawei_obs?.bucket_name || ''
        },
        wechat_app: {
            corp_id: config?.wechat_app?.corp_id || '',
            agent_id: config?.wechat_app?.agent_id || '',
            secret: config?.wechat_app?.secret || '',
            touser: config?.wechat_app?.touser || ''
        },
        tasks: Array.isArray(config.tasks) ? config.tasks.map(normalizeTask) : []
    });

    const setDirty = (dirty = true) => {
        state.dirty = dirty;
        if (refs.saveBtn) {
            refs.saveBtn.disabled = !dirty;
        }
    };

    const renderGlobalConfig = () => {
        const { huawei_obs, wechat_app } = state.config;
        refs.obs.bucket.value = huawei_obs.bucket_name;
        refs.obs.ak.value = huawei_obs.ak;
        refs.obs.sk.value = huawei_obs.sk;
        refs.obs.endpoint.value = huawei_obs.endpoint;
        refs.wechat.corpId.value = wechat_app.corp_id;
        refs.wechat.agentId.value = wechat_app.agent_id;
        refs.wechat.secret.value = wechat_app.secret;
        refs.wechat.touser.value = wechat_app.touser;
    };

    const buildDatabaseRow = (taskId, db, dbIndex) => `
        <div class="database-row" data-db-index="${dbIndex}" data-task-id="${taskId}">
            <input type="text" placeholder="前缀" data-db-field="prefix" value="${escapeHtml(db.prefix)}">
            <input type="text" placeholder="数据库名" data-db-field="name" value="${escapeHtml(db.name)}">
            <input type="text" placeholder="服务器" data-db-field="server" value="${escapeHtml(db.server)}">
            <input type="text" placeholder="账号" data-db-field="user" value="${escapeHtml(db.user)}">
            <input type="password" placeholder="密码" data-db-field="pass" value="${escapeHtml(db.pass)}">
            <input type="text" placeholder="计划时间，逗号分隔" data-db-field="times" value="${escapeHtml(db.times)}">
            <select data-db-field="backup_frequency">
                ${frequencyOptions.map(option => `<option value="${option}" ${option === db.backup_frequency ? 'selected' : ''}>${option}</option>`).join('')}
            </select>
            <input type="number" min="0" placeholder="保留数量" data-db-field="retention_count" value="${db.retention_count}">
            <button type="button" class="delete-database-btn" data-action="delete-database">删除</button>
        </div>`;

    const buildTaskCard = (task, index) => {
        const dbRows = task.databases.map((db, dbIndex) => buildDatabaseRow(task.id, db, dbIndex)).join('');
        const paymentModeLabel = task.requires_payment ? '付费审查' : '免审查';
        const dueDateDisplay = task.requires_payment ? (task.payment_due_date || '未设置') : '无需缴费';
        const dueChipClasses = ['payment-due-chip'];
        if (!task.requires_payment || !task.payment_due_date) {
            dueChipClasses.push('due-idle');
        }
        return `
            <div class="task-card" data-task-id="${task.id}">
                <div class="task-header">
                    <h3>
                        <input class="task-name" type="text" data-field="name" value="${escapeHtml(task.name)}" placeholder="任务名称">
                        <span class="task-id-container">
                            <span class="task-id-short" title="${task.id}">${task.id}</span>
                            <button class="copy-id-btn" data-action="copy-id" title="复制任务ID">复制</button>
                        </span>
                    </h3>
                    <div class="task-header-meta">
                        <div class="task-payment-meta">
                            <span class="payment-badge ${task.requires_payment ? 'required' : 'exempt'}">${paymentModeLabel}</span>
                            <span class="${dueChipClasses.join(' ')}" data-role="due-chip">
                                <span class="label">缴费截止</span>
                                <span class="value">${dueDateDisplay}</span>
                            </span>
                        </div>
                        <span class="status-chip pending" data-role="status-chip">待刷新</span>
                        <span class="emergency-chip ${task.emergency_backup}" data-role="emergency-chip">${task.emergency_backup || 'idle'}</span>
                        <button class="delete-task-btn" data-action="delete-task">删除任务</button>
                    </div>
                </div>
                <div class="task-body">
                    <div class="form-group">
                        <label>存储文件夹</label>
                        <input type="text" data-field="folder" value="${escapeHtml(task.folder)}" placeholder="OBS 中的目标子目录">
                    </div>
                    <div class="form-group">
                        <label>备注 1</label>
                        <textarea data-field="remark1" placeholder="如客户联系人等附加信息">${escapeHtml(task.remark1)}</textarea>
                    </div>
                    <div class="form-group">
                        <label>备注 2</label>
                        <textarea data-field="remark2" placeholder="其他补充说明">${escapeHtml(task.remark2)}</textarea>
                    </div>
                    <div class="form-group">
                        <label>付费客户审查</label>
                        <label style="display:flex; gap:0.5rem; align-items:center;">
                            <input type="checkbox" data-field="requires_payment" ${task.requires_payment ? 'checked' : ''}>
                            <span>${task.requires_payment ? '需要缴费核查' : '无需缴费'}</span>
                        </label>
                    </div>
                    <div class="form-group" data-payment-group style="${task.requires_payment ? '' : 'display:none;'}">
                        <label>缴费到期日</label>
                        <input type="date" data-field="payment_due_date" value="${task.payment_due_date || ''}">
                    </div>
                </div>
                <div class="database-section">
                    <div class="database-section-header">
                        <h4>数据库 (${task.databases.length})</h4>
                        <button type="button" class="add-database-btn" data-action="add-database">+ 添加数据库</button>
                    </div>
                    <div class="database-header">
                        <span>前缀</span>
                        <span>数据库</span>
                        <span>服务器</span>
                        <span>账号</span>
                        <span>密码</span>
                        <span>计划时间</span>
                        <span>频率</span>
                        <span>保留</span>
                        <span></span>
                    </div>
                    ${dbRows}
                </div>
                <div class="task-actions">
                    <div class="action-group">
                        <button type="button" class="secondary-btn" data-action="refresh-status">刷新状态</button>
                    </div>
                </div>
            </div>`;
    };

    const renderTaskList = () => {
        const tasks = state.config.tasks;
        if (!tasks.length) {
            refs.taskList.innerHTML = '<div class="empty-state">暂无备份任务，点击下方按钮添加。</div>';
            return;
        }
        refs.taskList.innerHTML = tasks.map(buildTaskCard).join('');
        setTimeout(() => refreshAllTaskStatuses(), 100);
    };

    const loadConfig = async () => {
        try {
            showMessage('正在加载配置...', 'info');
            setDirty(false);
            const config = await request('/api/config', { method: 'GET' });
            state.config = normalizeConfig(config);
            renderGlobalConfig();
            renderTaskList();
            showMessage('配置已加载', 'success');
        } catch (error) {
            showMessage(`加载失败：${error.message}`, 'error');
        }
    };

    const getTaskById = (taskId) => state.config.tasks.find(task => task.id === taskId);

    const handleTaskInput = (event) => {
        const card = event.target.closest('.task-card');
        if (!card) return;
        const task = getTaskById(card.dataset.taskId);
        if (!task) return;

        const { field } = event.target.dataset;
        const { dbField } = event.target.dataset;

        if (field) {
            let value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
            task[field] = value;
            if (field === 'requires_payment' || field === 'payment_due_date') {
                renderTaskList();
            }
            setDirty(true);
            return;
        }

        if (dbField) {
            const row = event.target.closest('.database-row');
            if (!row) return;
            const dbIndex = Number(row.dataset.dbIndex);
            const db = task.databases[dbIndex];
            if (!db) return;
            if (dbField === 'retention_count') {
                db[dbField] = Number(event.target.value) || 0;
            } else {
                db[dbField] = event.target.value;
            }
            setDirty(true);
        }
    };

    const addTask = () => {
        const newTask = normalizeTask({
            id: generateUUID(),
            name: `新任务${state.config.tasks.length + 1}`
        });
        state.config.tasks.push(newTask);
        renderTaskList();
        setDirty(true);
    };

    const deleteTask = (taskId) => {
        if (!confirm('确定要删除该任务吗？此操作不可恢复。')) return;
        state.config.tasks = state.config.tasks.filter(task => task.id !== taskId);
        renderTaskList();
        setDirty(true);
    };

    const addDatabaseRow = (taskId) => {
        const task = getTaskById(taskId);
        if (!task) return;
        task.databases.push(createEmptyDatabase());
        renderTaskList();
        setDirty(true);
    };

    const deleteDatabaseRow = (taskId, dbIndex) => {
        const task = getTaskById(taskId);
        if (!task) return;
        if (task.databases.length === 1) {
            showMessage('至少保留一个数据库配置。', 'error');
            return;
        }
        task.databases.splice(dbIndex, 1);
        renderTaskList();
        setDirty(true);
    };

    const copyTaskId = async (taskId) => {
        try {
            // [核心修复] 优先尝试现代、安全的剪贴板API
            await navigator.clipboard.writeText(taskId);
            showMessage(`任务 ID 已复制：${taskId}`, 'success');
        } catch (error) {
            // [核心修复] 如果现代API失败（例如在非https的IP地址访问时），则优雅降级到传统的 execCommand 方法
            console.warn('navigator.clipboard.writeText failed, falling back to execCommand.', error);
            const textArea = document.createElement("textarea");
            textArea.value = taskId;
            textArea.style.position = "fixed"; // 防止滚动条跳动
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                showMessage(`任务 ID 已复制：${taskId}`, 'success');
            } catch (fallbackError) {
                console.error('Fallback execCommand failed as well.', fallbackError);
                showMessage('复制失败，请手动选择文本。', 'error');
            }
            document.body.removeChild(textArea);
        }
    };

    const updateStatusChip = (card, statusPayload) => {
        const statusChip = card.querySelector('[data-role="status-chip"]');
        const emergencyChip = card.querySelector('[data-role="emergency-chip"]');
        if (!statusChip || !emergencyChip) return;

        const status = statusPayload?.status || '未知';
        statusChip.textContent = status === '异常' ? `异常 · ${statusPayload?.reason || '未知原因'}` : `正常 · ${statusPayload?.reason || '最新巡检正常'}`;
        statusChip.className = `status-chip ${status === '异常' ? 'error' : 'normal'}`;

        const emergencyState = statusPayload?.emergency_backup || 'idle';
        emergencyChip.textContent = emergencyState;
        emergencyChip.className = `emergency-chip ${emergencyState}`;
        if (statusPayload?.last_error) {
            emergencyChip.title = `最后错误：${statusPayload.last_error}`;
        }
    };

    const refreshTaskStatus = async (taskId) => {
        // [核心修复] 如果是尚未保存的临时任务，则直接跳过状态刷新，防止因404而引发无限循环
        if (!taskId || taskId.startsWith('temp-')) {
            const card = refs.taskList.querySelector(`.task-card[data-task-id="${taskId}"]`);
            if (card) {
                const statusChip = card.querySelector('[data-role="status-chip"]');
                if (statusChip) {
                    statusChip.textContent = '待保存';
                    statusChip.className = 'status-chip pending';
                }
            }
            return;
        }
        try {
            const payload = await request(`/api/tasks/${taskId}/status`, { method: 'GET' });
            state.statusCache[taskId] = payload;
            const card = refs.taskList.querySelector(`.task-card[data-task-id="${taskId}"]`);
            if (card) {
                updateStatusChip(card, payload);
            }
        } catch (error) {
            const card = refs.taskList.querySelector(`.task-card[data-task-id="${taskId}"]`);
            if (!card) return;
            const statusChip = card.querySelector('[data-role="status-chip"]');
            if (statusChip) {
                statusChip.textContent = `获取失败：${error.message}`;
                statusChip.className = 'status-chip error';
            }
        }
    };

    const refreshAllTaskStatuses = () => {
        state.config.tasks.forEach(task => refreshTaskStatus(task.id));
    };

    const handleTaskClick = (event) => {
        const action = event.target.dataset.action;
        if (!action) return;
        const card = event.target.closest('.task-card');
        const taskId = card?.dataset?.taskId;

        switch (action) {
            case 'delete-task':
                deleteTask(taskId);
                break;
            case 'add-database':
                addDatabaseRow(taskId);
                break;
            case 'delete-database': {
                const row = event.target.closest('.database-row');
                if (!row) return;
                deleteDatabaseRow(taskId, Number(row.dataset.dbIndex));
                break;
            }
            case 'copy-id':
                copyTaskId(taskId);
                break;
            case 'refresh-status':
                refreshTaskStatus(taskId);
                break;
            default:
                break;
        }
    };

    const collectPayload = () => ({
        huawei_obs: {
            bucket_name: refs.obs.bucket.value.trim(),
            ak: refs.obs.ak.value.trim(),
            sk: refs.obs.sk.value.trim(),
            endpoint: refs.obs.endpoint.value.trim()
        },
        wechat_app: {
            corp_id: refs.wechat.corpId.value.trim(),
            agent_id: refs.wechat.agentId.value.trim(),
            secret: refs.wechat.secret.value.trim(),
            touser: refs.wechat.touser.value.trim()
        },
        tasks: state.config.tasks.map(task => ({
            id: task.id,
            name: task.name.trim(),
            folder: task.folder.trim(),
            remark1: task.remark1,
            remark2: task.remark2,
            requires_payment: Boolean(task.requires_payment),
            payment_due_date: task.payment_due_date,
            emergency_backup: task.emergency_backup,
            last_error: task.last_error,
            last_status_update: task.last_status_update,
            databases: task.databases.map(db => ({
                prefix: db.prefix.trim(),
                name: db.name.trim(),
                server: db.server.trim(),
                user: db.user.trim(),
                pass: db.pass,
                times: db.times.trim(),
                backup_frequency: db.backup_frequency,
                retention_count: Number(db.retention_count) || 0
            }))
        }))
    });

    const saveConfig = async () => {
        const payload = collectPayload();
        try {
            refs.saveBtn.disabled = true;
            showMessage('正在保存配置...', 'info');
            await request('/api/config', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showMessage('配置保存成功。', 'success');
            setDirty(false);
            await loadConfig();
        } catch (error) {
            showMessage(`保存失败：${error.message}`, 'error');
            setDirty(true);
        }
    };

    const watchGlobalInputs = () => {
        Object.values(refs.obs).forEach((input) => {
            if (input) input.addEventListener('input', () => setDirty(true));
        });
        Object.values(refs.wechat).forEach((input) => {
            if (input) input.addEventListener('input', () => setDirty(true));
        });
    };

    const bindEvents = () => {
        if (refs.addTaskBtn) {
            refs.addTaskBtn.addEventListener('click', addTask);
        }
        if (refs.saveBtn) {
            refs.saveBtn.addEventListener('click', saveConfig);
        }
        if (refs.taskList) {
            refs.taskList.addEventListener('input', handleTaskInput);
            refs.taskList.addEventListener('change', handleTaskInput);
            refs.taskList.addEventListener('click', handleTaskClick);
        }
        watchGlobalInputs();
    };

    bindEvents();
    loadConfig();
});
