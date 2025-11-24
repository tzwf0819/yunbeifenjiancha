
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('authToken');
    if (!token) return window.location.href = '/login';

    const bucketList = document.getElementById('bucket-list');
    const message = document.getElementById('message');
    
    let currentConfig = { huawei_obs: {}, wechat_app: {}, buckets: [] };

    const fetchConfig = async () => {
        try {
            const response = await fetch('/api/config', { headers: { 'Authorization': `Bearer ${token}` } });
            if (response.status === 401) return window.location.href = '/login';
            const loadedConfig = await response.json();
            currentConfig = { ...currentConfig, ...loadedConfig };
            if (!currentConfig.buckets) currentConfig.buckets = [];
            renderGlobalConfig();
            renderAllBucketCards();
        } catch (e) {
            console.error("Config load error:", e);
            message.textContent = '加载配置失败。';
            message.className = 'error-message';
        }
    };

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

    const createBucketCard = (bucket, index) => {
        const card = document.createElement('div');
        card.className = 'bucket-card';
        card.dataset.index = index;
        
        card.innerHTML = `
            <h3>
                <input type="text" class="bucket-name-input" placeholder="存储桶名称" value="${bucket.name || ''}" style="border:none; background:transparent; font-size: 1.17em; font-weight: bold;">
                <button type="button" class="delete-bucket-btn danger-btn">删除此桶</button>
            </h3>
            <div class="form-group">
                <label>付费到期日:</label>
                <input type="date" class="bucket-payment-due-date" value="${bucket.payment_due_date || ''}">
            </div>
            <table class="item-table">
                <thead>
                    <tr>
                        <th>备份文件名前缀</th>
                        <th>备份计划</th>
                        <th style="width: 50px;">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${(bucket.items || []).map((item, itemIndex) => `
                        <tr data-item-index="${itemIndex}">
                            <td><input type="text" class="item-prefix" value="${item.prefix}"></td>
                            <td>
                                <select class="item-schedule">
                                    <option value="daily_1" ${item.schedule === 'daily_1' ? 'selected' : ''}>每天 1 次</option>
                                    <option value="daily_2" ${item.schedule === 'daily_2' ? 'selected' : ''}>每天 2 次</option>
                                    <option value="daily_3" ${item.schedule === 'daily_3' ? 'selected' : ''}>每天 3 次</option>
                                    <option value="hourly_1" ${item.schedule === 'hourly_1' ? 'selected' : ''}>每小时 1 次</option>
                                </select>
                            </td>
                            <td><button type="button" class="delete-item-btn danger-btn">-</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <button type="button" class="add-item-btn secondary-btn" style="margin-top: 10px;">+ 添加备份文件规则</button>
        `;
        return card;
    };
    
    const renderAllBucketCards = () => {
        bucketList.innerHTML = '';
        currentConfig.buckets.forEach((bucket, index) => {
            bucketList.appendChild(createBucketCard(bucket, index));
        });
    };

    document.getElementById('add-bucket-card-btn').addEventListener('click', () => {
        const newBucket = { name: '', payment_due_date: '', items: [] };
        currentConfig.buckets.push(newBucket);
        renderAllBucketCards();
    });

    bucketList.addEventListener('click', (e) => {
        const card = e.target.closest('.bucket-card');
        if (!card) return;

        const bucketIndex = parseInt(card.dataset.index, 10);

        if (e.target.classList.contains('delete-bucket-btn')) {
            if (confirm(`确定要删除存储桶 ${currentConfig.buckets[bucketIndex].name || '新存储桶'} 吗？`)) {
                currentConfig.buckets.splice(bucketIndex, 1);
                renderAllBucketCards();
            }
        }

        if (e.target.classList.contains('add-item-btn')) {
            if (!currentConfig.buckets[bucketIndex].items) {
                currentConfig.buckets[bucketIndex].items = [];
            }
            currentConfig.buckets[bucketIndex].items.push({ prefix: '', schedule: 'daily_1' });
            renderAllBucketCards();
        }

        if (e.target.classList.contains('delete-item-btn')) {
            const itemIndex = parseInt(e.target.closest('tr').dataset.itemIndex, 10);
            currentConfig.buckets[bucketIndex].items.splice(itemIndex, 1);
            renderAllBucketCards();
        }
    });

    document.getElementById('save-all-btn').addEventListener('click', async () => {
        // Collect data from the DOM
        const newBuckets = [];
        document.querySelectorAll('.bucket-card').forEach(card => {
            const bucketName = card.querySelector('.bucket-name-input').value.trim();
            if (!bucketName) return; 

            const items = [];
            card.querySelectorAll('.item-table tbody tr').forEach(row => {
                const prefix = row.querySelector('.item-prefix').value.trim();
                if (prefix) {
                    items.push({
                        prefix: prefix,
                        schedule: row.querySelector('.item-schedule').value
                    });
                }
            });

            newBuckets.push({
                name: bucketName,
                payment_due_date: card.querySelector('.bucket-payment-due-date').value,
                items: items
            });
        });

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
            buckets: newBuckets
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
            // Reload to reflect saved state
            fetchConfig();
        } catch (error) {
            message.textContent = `保存失败: ${error.message}`;
            message.className = 'error-message';
        }
    });

    fetchConfig();
});
