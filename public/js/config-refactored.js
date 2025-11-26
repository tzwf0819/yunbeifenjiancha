
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('authToken');
    if (!token) return window.location.href = '/login';

    // --- DOM Elements ---
    const taskList = document.getElementById('task-list');
    const message = document.getElementById('message');
    const saveButton = document.getElementById('save-config');
    const addTaskButton = document.getElementById('add-task');
    const obsAkInput = document.getElementById('obs-ak');
    const obsSkInput = document.getElementById('obs-sk');
    const obsEndpointInput = document.getElementById('obs-endpoint');
    const obsBucketNameInput = document.getElementById('obs-bucket-name');
    const wechatCorpIdInput = document.getElementById('wechat-corp-id');
    const wechatAgentIdInput = document.getElementById('wechat-agent-id');
    const wechatSecretInput = document.getElementById('wechat-secret');
    const wechatToUserInput = document.getElementById('wechat-touser');

    let currentConfig = {};

    // --- Utility Functions ---
    const showMessage = (msg, type = 'info') => {
        message.textContent = msg;
        message.className = `message ${type}`;
        setTimeout(() => message.textContent = '', 3000);
    };

    const debounce = (func, delay) => {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    };

    // --- Data Fetching and Saving ---
    const fetchConfig = async () => {
        try {
            const response = await fetch('/api/config', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.status === 401) return window.location.href = '/login';
            if (!response.ok) throw new Error(`网络响应错误: ${response.statusText}`);
            currentConfig = await response.json();
            renderUI();
        } catch (e) {
            showMessage(`加载配置失败: ${e.message}`, 'error');
        }
    };

    const saveConfig = async () => {
        saveButton.disabled = true;
        saveButton.textContent = '保存中...';
        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(currentConfig)
            });
            if (!response.ok) throw new Error('保存失败');
            const result = await response.json();
            showMessage(result.message, 'success');
            await fetchConfig(); // Re-fetch to get new IDs if any
        } catch (e) {
            showMessage(e.message, 'error');
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = '保存配置';
        }
    };

    // --- Rendering Functions ---
    const renderUI = () => {
        renderGlobalConfig();
        renderAllTaskCards();
    };

    const renderGlobalConfig = () => {
        obsAkInput.value = currentConfig.huawei_obs?.ak || '';
        obsSkInput.value = currentConfig.huawei_obs?.sk || '';
        obsEndpointInput.value = currentConfig.huawei_obs?.endpoint || '';
        obsBucketNameInput.value = currentConfig.huawei_obs?.bucket_name || '';
        wechatCorpIdInput.value = currentConfig.wechat_app?.corp_id || '';
        wechatAgentIdInput.value = currentConfig.wechat_app?.agent_id || '';
        wechatSecretInput.value = currentConfig.wechat_app?.secret || '';
        wechatToUserInput.value = currentConfig.wechat_app?.touser || '';
    };

    const createDatabaseRow = (db, taskIndex, dbIndex) => {
        const row = document.createElement('div');
        row.className = 'database-row';
        row.dataset.dbIndex = dbIndex;
        row.innerHTML = `
            <input type="text" class="db-prefix" value="${db.prefix || ''}" placeholder="文件名前缀">
            <input type="text" class="db-server" value="${db.server || ''}" placeholder="数据库服务器">
            <input type="text" class="db-user" value="${db.user || ''}" placeholder="用户名">
            <input type="password" class="db-pass" value="${db.pass || ''}" placeholder="密码">
            <input type="text" class="db-name" value="${db.name || ''}" placeholder="数据库名">
            <input type="text" class="db-times" value="${db.times || ''}" placeholder="备份时间 (HH:mm)">
            <button class="delete-database-btn">删除库</button>
        `;
        return row;
    };

    const createTaskCard = (task, taskIndex) => {
        const card = document.createElement('div');
        card.className = 'task-card';
        card.dataset.taskIndex = taskIndex;
        card.dataset.taskId = task.id || ''; // Store the unique ID

        card.innerHTML = `
            <div class="task-header">
                <h3>任务: <input type="text" class="task-name" value="${task.name || ''}" placeholder="任务名称"></h3>
                <div class="task-id">ID: ${task.id ? task.id.substring(0, 16) : '保存后生成'}</div>
            </div>
            <div class="task-body">
                <div class="form-group">
                    <label>OBS 存储路径</label>
                    <input type="text" class="task-folder" value="${task.folder || ''}" placeholder="OBS 存储路径 (子目录)">
                </div>
                <div class="form-group">
                    <label>付款到期日</label>
                    <input type="date" class="task-payment-due-date" value="${task.payment_due_date || ''}">
                </div>
                <div class="form-group">
                    <label>备注1</label>
                    <input type="text" class="task-remark1" value="${task.remark1 || ''}" placeholder="备注1">
                </div>
                <div class="form-group">
                    <label>备注2</label>
                    <input type="text" class="task-remark2" value="${task.remark2 || ''}" placeholder="备注2">
                </div>
            </div>
            <div class="database-section">
                <div class="database-section-header">
                    <h4>数据库列表</h4>
                    <button type="button" class="add-database-btn">+ 添加数据库</button>
                </div>
                <div class="database-header">
                    <span>文件名前缀</span>
                    <span>服务器</span>
                    <span>用户名</span>
                    <span>密码</span>
                    <span>数据库名</span>
                    <span>备份时间</span>
                    <span>操作</span>
                </div>
                <div class="database-list"></div>
            </div>
            <div class="task-actions">
                 <button type="button" class="delete-task-btn">删除任务</button>
                 <button type="button" class="emergency-backup-btn primary-btn" ${!task.id ? 'disabled' : ''}>${task.id ? '紧急备份' : '需先保存'}</button>
            </div>
        `;

        const dbList = card.querySelector('.database-list');
        (task.databases || []).forEach((db, dbIndex) => {
            dbList.appendChild(createDatabaseRow(db, taskIndex, dbIndex));
        });

        return card;
    };

    const renderAllTaskCards = () => {
        taskList.innerHTML = '';
        (currentConfig.tasks || []).forEach((task, index) => {
            taskList.appendChild(createTaskCard(task, index));
        });
    };

    // --- Event Handlers ---
    const updateGlobalConfig = () => {
        currentConfig.huawei_obs = {
            ak: obsAkInput.value,
            sk: obsSkInput.value,
            endpoint: obsEndpointInput.value,
            bucket_name: obsBucketNameInput.value,
        };
        currentConfig.wechat_app = {
            corp_id: wechatCorpIdInput.value,
            agent_id: wechatAgentIdInput.value,
            secret: wechatSecretInput.value,
            touser: wechatToUserInput.value,
        };
    };

    const handleTaskListChange = (e) => {
        const taskCard = e.target.closest('.task-card');
        if (!taskCard) return;

        const taskIndex = parseInt(taskCard.dataset.taskIndex, 10);
        const task = currentConfig.tasks[taskIndex];

        if (e.target.matches('.task-name, .task-folder, .task-payment-due-date, .task-remark1, .task-remark2')) {
            task.name = taskCard.querySelector('.task-name').value;
            task.folder = taskCard.querySelector('.task-folder').value;
            task.payment_due_date = taskCard.querySelector('.task-payment-due-date').value;
            task.remark1 = taskCard.querySelector('.task-remark1').value;
            task.remark2 = taskCard.querySelector('.task-remark2').value;
        }

        const dbRow = e.target.closest('.database-row');
        if (dbRow) {
            const dbIndex = parseInt(dbRow.dataset.dbIndex, 10);
            const db = task.databases[dbIndex];
            db.prefix = dbRow.querySelector('.db-prefix').value;
            db.server = dbRow.querySelector('.db-server').value;
            db.user = dbRow.querySelector('.db-user').value;
            db.pass = dbRow.querySelector('.db-pass').value;
            db.name = dbRow.querySelector('.db-name').value;
            db.times = dbRow.querySelector('.db-times').value;
        }
    };
    
    const handleTaskListClick = (e) => {
        const taskCard = e.target.closest('.task-card');
        if (!taskCard) return;
        
        const taskIndex = parseInt(taskCard.dataset.taskIndex, 10);

        if (e.target.classList.contains('delete-task-btn')) {
            if (confirm(`确定要删除任务 "${currentConfig.tasks[taskIndex].name}"吗？`)) {
                currentConfig.tasks.splice(taskIndex, 1);
                renderUI();
            }
        }

        if (e.target.classList.contains('add-database-btn')) {
            currentConfig.tasks[taskIndex].databases.push({});
            renderUI();
        }

        const dbRow = e.target.closest('.database-row');
        if (e.target.classList.contains('delete-database-btn') && dbRow) {
            const dbIndex = parseInt(dbRow.dataset.dbIndex, 10);
            currentConfig.tasks[taskIndex].databases.splice(dbIndex, 1);
            renderUI();
        }
        
        // --- Emergency Backup ---
        if (e.target.classList.contains('emergency-backup-btn')) {
             handleEmergencyBackup(e);
        }
    };
    
    // --- New Emergency Backup Logic ---
    const handleEmergencyBackup = async (e) => {
        const button = e.target;
        const card = button.closest('.task-card');
        const taskId = card.dataset.taskId;

        if (!taskId) return;

        button.disabled = true;
        button.textContent = '请求中...';

        try {
            const response = await fetch(`/api/tasks/${taskId}/trigger-emergency-backup`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                const errorResult = await response.json();
                throw new Error(errorResult.message || `HTTP错误 ${response.status}`);
            }
            
            showMessage(`任务 ${taskId.substring(0,8)}... 的紧急备份已触发`, 'info');
            pollStatus(button, taskId);

        } catch (error) {
            showMessage(`触发失败: ${error.message}`, 'error');
            button.disabled = false;
            button.textContent = '紧急备份';
        }
    };

    const pollStatus = (button, taskId) => {
        button.textContent = '待处理';
        const pollInterval = 3000; // 3 seconds
        const timeout = 300000; // 5 minutes
        let elapsedTime = 0;

        const intervalId = setInterval(async () => {
            elapsedTime += pollInterval;

            if (elapsedTime >= timeout) {
                clearInterval(intervalId);
                button.textContent = '轮询超时';
                button.disabled = false;
                button.style.backgroundColor = '';
                return;
            }

            try {
                const res = await fetch(`/api/tasks/${taskId}/status`, { 
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!res.ok) {
                    clearInterval(intervalId);
                    button.textContent = '状态未知';
                    button.disabled = false;
                    return;
                }
                const { status } = await res.json();

                switch (status) {
                    case 'pending':
                        button.textContent = '备份中...';
                        button.style.backgroundColor = '#f39c12'; // Orange
                        break;
                    case 'completed':
                        button.textContent = '已完成!';
                        button.style.backgroundColor = '#2ecc71'; // Green
                        clearInterval(intervalId);
                        setTimeout(() => { // Reset button after a while
                            button.disabled = false;
                            button.textContent = '紧急备份';
                            button.style.backgroundColor = '';
                        }, 5000);
                        break;
                    case 'idle':
                    default:
                        // Nothing to do, just keep polling
                        button.textContent = '待处理';
                        break;
                }
            } catch (err) {
                clearInterval(intervalId);
                button.textContent = '轮询出错';
                button.disabled = false;
            }
        }, pollInterval);
    };

    // --- Event Listeners ---
    document.querySelector('.global-config').addEventListener('input', debounce(updateGlobalConfig, 400));
    taskList.addEventListener('input', debounce(handleTaskListChange, 400));
    taskList.addEventListener('click', handleTaskListClick);
    
    saveButton.addEventListener('click', saveConfig);
    
    addTaskButton.addEventListener('click', () => {
        currentConfig.tasks = currentConfig.tasks || [];
        currentConfig.tasks.push({ name: '新任务', databases: [] });
        renderUI();
    });

    // --- Initial Load ---
    fetchConfig();
});
