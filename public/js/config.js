
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('authToken');
    if (!token) return window.location.href = '/login';

    let currentConfig = { huawei_obs: {}, wechat_app: {}, buckets: [] };
    const message = document.getElementById('message');
    const bucketTableBody = document.querySelector('#bucket-table tbody');

    // Main Modal (Bucket)
    const bucketModal = document.getElementById('bucket-modal');
    const closeBucketModalBtn = bucketModal.querySelector('.close-btn');
    const saveBucketBtn = document.getElementById('save-bucket-btn');
    const addBucketBtn = document.getElementById('add-bucket-btn');
    const itemsTableBody = document.querySelector('#monitored-items-table tbody');

    // Item Modal (Monitored Item)
    const itemModal = document.getElementById('item-modal');
    const closeItemModalBtn = itemModal.querySelector('.close-btn-item');
    const saveItemBtn = document.getElementById('save-item-btn');
    const addItemBtn = document.getElementById('add-item-btn');

    // --- RENDER FUNCTIONS ---
    const renderGlobalConfig = () => {
        const { huawei_obs, wechat_app } = currentConfig;
        if (huawei_obs) {
            document.getElementById('obs-ak').value = huawei_obs.ak || '';
            document.getElementById('obs-sk').value = huawei_obs.sk || '';
            document.getElementById('obs-endpoint').value = huawei_obs.endpoint || '';
        }
        if (wechat_app) {
            document.getElementById('wechat-corp-id').value = wechat_app.corp_id || '';
            document.getElementById('wechat-agent-id').value = wechat_app.agent_id || '';
            document.getElementById('wechat-secret').value = wechat_app.secret || '';
            document.getElementById('wechat-touser').value = wechat_app.touser || '';
        }
    };

    const renderBucketList = () => {
        bucketTableBody.innerHTML = '';
        currentConfig.buckets.forEach((bucket, index) => {
            const row = bucketTableBody.insertRow();
            row.innerHTML = `
                <td>${bucket.name}</td>
                <td>${bucket.items.length}</td>
                <td>${bucket.payment_due_date || '未设置'}</td>
                <td>
                    <button type="button" class="edit-bucket-btn secondary-btn" data-index="${index}">编辑</button>
                    <button type="button" class="delete-bucket-btn secondary-btn" data-index="${index}">删除</button>
                </td>
            `;
        });
    };

    const renderItemsList = (bucketIndex) => {
        itemsTableBody.innerHTML = '';
        const bucket = currentConfig.buckets[bucketIndex];
        if (!bucket || !bucket.items) return;

        bucket.items.forEach((item, itemIndex) => {
            const scheduleMap = { 'daily_1': '每天1次', 'daily_2': '每天2次', 'daily_3': '每天3次', 'hourly_1': '每小时1次' };
            const row = itemsTableBody.insertRow();
            row.innerHTML = `
                <td>${item.prefix}</td>
                <td>${scheduleMap[item.schedule] || '未知'}</td>
                <td>
                    <button type="button" class="edit-item-btn secondary-btn" data-index="${itemIndex}">编辑</button>
                    <button type="button" class="delete-item-btn secondary-btn" data-index="${itemIndex}">删除</button>
                </td>
            `;
        });
    };

    // --- MODAL LOGIC ---
    const openBucketModal = (bucketIndex) => {
        document.getElementById('bucket-edit-index').value = bucketIndex;
        if (bucketIndex >= 0) { // Edit
            const bucket = currentConfig.buckets[bucketIndex];
            document.getElementById('modal-title').textContent = '编辑存储桶';
            document.getElementById('bucket-name').value = bucket.name;
            document.getElementById('bucket-name').readOnly = true;
            document.getElementById('bucket-payment-due-date').value = bucket.payment_due_date || '';
            renderItemsList(bucketIndex);
        } else { // Add
            document.getElementById('modal-title').textContent = '添加新存储桶';
            document.getElementById('bucket-name').value = '';
            document.getElementById('bucket-name').readOnly = false;
            document.getElementById('bucket-payment-due-date').value = '';
            itemsTableBody.innerHTML = ''; // Clear items for new bucket
        }
        bucketModal.style.display = 'block';
    };

    const openItemModal = (bucketIndex, itemIndex) => {
        document.getElementById('item-edit-index').value = itemIndex;
        if (itemIndex >= 0) { // Edit
            const item = currentConfig.buckets[bucketIndex].items[itemIndex];
            document.getElementById('item-modal-title').textContent = '编辑监控项';
            document.getElementById('item-prefix').value = item.prefix;
            document.getElementById('item-schedule').value = item.schedule;
        } else { // Add
            document.getElementById('item-modal-title').textContent = '添加监控项';
            document.getElementById('item-prefix').value = '';
            document.getElementById('item-schedule').value = 'daily_1';
        }
        itemModal.style.display = 'block';
    };

    // -- Event Listeners for Modals --
    addBucketBtn.onclick = () => openBucketModal(-1);
    closeBucketModalBtn.onclick = () => bucketModal.style.display = 'none';
    closeItemModalBtn.onclick = () => itemModal.style.display = 'none';
    window.onclick = (event) => {
        if (event.target == bucketModal) bucketModal.style.display = 'none';
        if (event.target == itemModal) itemModal.style.display = 'none';
    };

    // --- DATA HANDLING ---
    try { // Initial Load
        const response = await fetch('/api/config', { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.status === 401) return window.location.href = '/login';
        const loadedConfig = await response.json();
        currentConfig = { ...currentConfig, ...loadedConfig };
        if (!currentConfig.buckets) currentConfig.buckets = [];
        renderGlobalConfig();
        renderBucketList();
    } catch (e) {
        console.error("Config load error:", e);
        message.textContent = '加载配置失败，可能为空或格式错误。';
        message.className = 'error-message';
    }

    // Main List Actions
    bucketTableBody.addEventListener('click', (e) => {
        const index = e.target.dataset.index;
        if (e.target.classList.contains('edit-bucket-btn')) {
            openBucketModal(index);
        }
        if (e.target.classList.contains('delete-bucket-btn')) {
            if (confirm(`确定要删除存储桶 ${currentConfig.buckets[index].name} 吗？`)) {
                currentConfig.buckets.splice(index, 1);
                renderBucketList();
            }
        }
    });

    // Bucket Modal Actions
    saveBucketBtn.onclick = () => {
        const bucketIndex = document.getElementById('bucket-edit-index').value;
        const bucketName = document.getElementById('bucket-name').value.trim();
        if (!bucketName) return alert('存储桶名称不能为空！');

        const bucketData = {
            name: bucketName,
            payment_due_date: document.getElementById('bucket-payment-due-date').value,
            items: (bucketIndex >= 0) ? currentConfig.buckets[bucketIndex].items : []
        };
        
        if (bucketIndex >= 0) { // Edit
            currentConfig.buckets[bucketIndex] = bucketData;
        } else { // Add
            currentConfig.buckets.push(bucketData);
        }
        renderBucketList();
        bucketModal.style.display = 'none';
    };

    addItemBtn.onclick = () => {
        const bucketIndex = document.getElementById('bucket-edit-index').value;
        if (bucketIndex < 0) return alert('请先保存存储桶基本信息！');
        openItemModal(bucketIndex, -1);
    };

    itemsTableBody.addEventListener('click', (e) => {
        const bucketIndex = document.getElementById('bucket-edit-index').value;
        const itemIndex = e.target.dataset.index;
        if (e.target.classList.contains('edit-item-btn')) {
            openItemModal(bucketIndex, itemIndex);
        }
        if (e.target.classList.contains('delete-item-btn')) {
            if(confirm(`确定删除监控项 ${currentConfig.buckets[bucketIndex].items[itemIndex].prefix} 吗？`)) {
                currentConfig.buckets[bucketIndex].items.splice(itemIndex, 1);
                renderItemsList(bucketIndex);
            }
        }
    });

    // Item Modal Actions
    saveItemBtn.onclick = () => {
        const bucketIndex = document.getElementById('bucket-edit-index').value;
        const itemIndex = document.getElementById('item-edit-index').value;
        const itemData = {
            prefix: document.getElementById('item-prefix').value.trim(),
            schedule: document.getElementById('item-schedule').value
        };
        if (!itemData.prefix) return alert('备份文件名前缀不能为空！');

        if (!currentConfig.buckets[bucketIndex].items) currentConfig.buckets[bucketIndex].items = [];

        if (itemIndex >= 0) { // Edit
            currentConfig.buckets[bucketIndex].items[itemIndex] = itemData;
        } else { // Add
            currentConfig.buckets[bucketIndex].items.push(itemData);
        }
        renderItemsList(bucketIndex);
        itemModal.style.display = 'none';
    };

    // --- GLOBAL SAVE ---
    document.getElementById('save-btn').addEventListener('click', async () => {
        // Just gather global config, buckets are already updated in `currentConfig`
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
            const result = await response.json();
            message.textContent = result.success ? '保存成功！' : (result.message || '保存失败！');
            message.className = result.success ? 'success-message' : 'error-message';
        } catch (error) {
            message.textContent = `保存失败: ${error.message}`;
            message.className = 'error-message';
        }
    });
});
