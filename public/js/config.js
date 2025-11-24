
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    let currentConfig = { huawei_obs: {}, wechat_app: {}, buckets: [] }; // 初始化以防止undefined错误
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

    const renderBucketList = (buckets) => {
        bucketTableBody.innerHTML = '';
        buckets.forEach((bucket, index) => {
            const row = document.createElement('tr');
            const scheduleText = `每${bucket.schedule_frequency === 'daily' ? '天' : '小时'} ${bucket.schedule_count} 次`;
            row.innerHTML = `
                <td>${bucket.name}</td>
                <td>${scheduleText}</td>
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
            const scheduleValue = `${bucket.schedule_frequency || 'daily'},${bucket.schedule_count || 1}`;
            document.getElementById('bucket-schedule').value = scheduleValue;
            document.getElementById('bucket-payment-due-date').value = bucket.payment_due_date || '';
        } else { // Add mode
            modalTitle.textContent = '添加新存储桶';
            document.getElementById('bucket-name').value = '';
            document.getElementById('bucket-name').readOnly = false;
            document.getElementById('bucket-schedule').value = 'daily,1';
            document.getElementById('bucket-payment-due-date').value = '';
        }
        modal.style.display = 'block';
    };

    const closeModal = () => {
        modal.style.display = 'none';
    };

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
        renderBucketList(currentConfig.buckets || []);
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
        const scheduleValue = document.getElementById('bucket-schedule').value.split(',');
        const bucketData = {
            name: document.getElementById('bucket-name').value.trim(),
            schedule_frequency: scheduleValue[0],
            schedule_count: parseInt(scheduleValue[1], 10),
            payment_due_date: document.getElementById('bucket-payment-due-date').value
        };
        if (!bucketData.name) { alert('存储桶名称不能为空！'); return; }

        if (!currentConfig.buckets) { // **BUG FIX**: Initialize buckets array if it doesn't exist
            currentConfig.buckets = [];
        }

        if (index >= 0) { // Edit
            currentConfig.buckets[index] = bucketData;
        } else { // Add
            currentConfig.buckets.push(bucketData);
        }
        renderBucketList(currentConfig.buckets);
        closeModal();
    });

    // --- Main Save Button ---
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
            buckets: currentConfig.buckets
        };

        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(finalConfig)
            });
            if (response.status === 401) return window.location.href = '/login';
            const result = await response.json();
            message.textContent = result.success ? '保存成功！' : (result.message || '保存失败！');
            message.className = result.success ? 'success-message' : 'error-message';
        } catch (error) {
            message.textContent = '发生网络错误，保存失败！';
            message.className = 'error-message';
        }
    });
});
