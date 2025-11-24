
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    let currentConfig = { huawei_obs: {}, wechat_app: {}, buckets: [] }; // Initialize to prevent undefined errors
    const message = document.getElementById('message');
    const bucketTableBody = document.querySelector('#bucket-table tbody');

    const modal = document.getElementById('bucket-modal');
    const closeModalBtn = document.querySelector('.close-btn');
    const saveBucketBtn = document.getElementById('save-bucket-btn');
    const addBucketBtn = document.getElementById('add-bucket-btn');
    const modalTitle = document.getElementById('modal-title');

    // --- Render Functions ---
    const renderGlobalConfig = (config) => {
        if (config.huawei_obs) {
            document.getElementById('obs-ak').value = config.huawei_obs.ak || '';
            document.getElementById('obs-sk').value = config.huawei_obs.sk || '';
            document.getElementById('obs-endpoint').value = config.huawei_obs.endpoint || '';
        }
        if (config.wechat_app) {
            document.getElementById('wechat-corp-id').value = config.wechat_app.corp_id || '';
            document.getElementById('wechat-agent-id').value = config.wechat_app.agent_id || '';
            document.getElementById('wechat-secret').value = config.wechat_app.secret || '';
            document.getElementById('wechat-touser').value = config.wechat_app.touser || '';
        }
    };

    const renderBucketList = (buckets = []) => {
        bucketTableBody.innerHTML = '';
        buckets.forEach((bucket, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${bucket.name}</td>
                <td>${bucket.payment_due_date || '未设置'}</td>
                <td>
                    <button type="button" class="edit-bucket-btn secondary-btn" data-index="${index}">编辑</button>
                    <button type="button" class="delete-bucket-btn secondary-btn" data-index="${index}">删除</button>
                </td>
            `;
            bucketTableBody.appendChild(row);
        });
    };

    // --- Modal Logic ---
    const openModal = (bucket, index) => {
        document.getElementById('bucket-edit-index').value = index;
        if (bucket) { // Edit mode
            modalTitle.textContent = '编辑存储桶';
            document.getElementById('bucket-name').value = bucket.name;
            document.getElementById('bucket-name').readOnly = true;
            document.getElementById('bucket-payment-due-date').value = bucket.payment_due_date || '';
        } else { // Add mode
            modalTitle.textContent = '添加新存储桶';
            document.getElementById('bucket-name').value = '';
            document.getElementById('bucket-name').readOnly = false;
            document.getElementById('bucket-payment-due-date').value = '';
        }
        modal.style.display = 'block';
    };

    const closeModal = () => { modal.style.display = 'none'; };

    addBucketBtn.addEventListener('click', () => openModal(null, -1));
    closeModalBtn.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        if (event.target == modal) closeModal();
    });

    // --- Data Logic ---
    try { // Initial Load
        const response = await fetch('/api/config', { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.status === 401) return window.location.href = '/login';
        const loadedConfig = await response.json();
        if (Object.keys(loadedConfig).length > 0) {
            currentConfig = { ...currentConfig, ...loadedConfig };
        }
        renderGlobalConfig(currentConfig);
        renderBucketList(currentConfig.buckets);
    } catch (error) { 
        console.error("Error loading config:", error);
        message.textContent = '加载配置失败! (可能为空)'; 
        message.className = 'error-message'; 
    }

    bucketTableBody.addEventListener('click', (event) => {
        const index = event.target.dataset.index;
        if (event.target.classList.contains('edit-bucket-btn')) {
            openModal(currentConfig.buckets[index], index);
        }
        if (event.target.classList.contains('delete-bucket-btn')) {
            if (confirm(`确定要删除存储桶 ${currentConfig.buckets[index].name} 吗？`)) {
                currentConfig.buckets.splice(index, 1);
                renderBucketList(currentConfig.buckets);
            }
        }
    });

    saveBucketBtn.addEventListener('click', () => {
        const index = document.getElementById('bucket-edit-index').value;
        const bucketData = {
            name: document.getElementById('bucket-name').value.trim(),
            payment_due_date: document.getElementById('bucket-payment-due-date').value
        };
        if (!bucketData.name) { alert('存储桶名称不能为空！'); return; }
        if (!currentConfig.buckets) currentConfig.buckets = [];

        if (index >= 0) { // Edit
            currentConfig.buckets[index] = bucketData;
        } else { // Add
            currentConfig.buckets.push(bucketData);
        }
        renderBucketList(currentConfig.buckets);
        closeModal();
    });

    // --- Main Save Button & Run Check Logic ---
    document.getElementById('save-btn').addEventListener('click', async () => {
        const finalConfig = {
            huawei_obs: {
                ak: document.getElementById('obs-ak').value.trim(),
                sk: document.getElementById('obs-sk').value.trim(),
                endpoint: document.getElementById('obs-endpoint').value.trim()
            },
            wechat_app: {
                corp_id: document.getElementById('wechat-corp-id').value.trim(),
                agent_id: document.getElementById('wechat-agent-id').value.trim(),
                secret: document.getElementById('wechat-secret').value.trim(),
                touser: document.getElementById('wechat-touser').value.trim()
            },
            buckets: currentConfig.buckets || []
        };

        try {
            message.textContent = '正在保存配置...';
            message.className = '';
            const saveResponse = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(finalConfig)
            });
            if (saveResponse.status === 401) return window.location.href = '/login';
            const saveResult = await saveResponse.json();

            if (!saveResult.success) throw new Error(saveResult.message || '保存失败');

            message.textContent = '配置保存成功！正在触发即时巡检，请稍候...';
            message.className = 'success-message';

            const checkResponse = await fetch('/api/run-check', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const checkResult = await checkResponse.json();
            
            if (checkResult.success) {
                 message.textContent = `保存成功！${checkResult.message}`;
                 message.className = 'success-message';
            } else {
                throw new Error(checkResult.message || '巡检触发失败');
            }

        } catch (error) {
            message.textContent = `操作失败: ${error.message}`;
            message.className = 'error-message';
        }
    });
});
