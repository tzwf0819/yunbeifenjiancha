
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    const message = document.getElementById('message');

    // 加载并填充配置
    try {
        const response = await fetch('/api/config', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401 || response.status === 400) {
            window.location.href = '/login';
            return;
        }
        const config = await response.json();
        
        // 填充OBS配置
        if (config.obs_config) {
            document.getElementById('obs-access-key').value = config.obs_config.access_key || '';
            document.getElementById('obs-secret-key').value = config.obs_config.secret_key || '';
            document.getElementById('obs-region').value = config.obs_config.region || '';
            document.getElementById('obs-special-buckets').value = (config.obs_config.special_buckets || []).join(', ');
            document.getElementById('obs-bucket-schedules').value = (config.obs_config.bucket_schedules || []).join(', ');
            document.getElementById('obs-bucket-payment-dates').value = JSON.stringify(config.obs_config.bucket_payment_dates || {}, null, 2);
        }

        // 填充企业微信配置
        if (config.wechat_app) {
            document.getElementById('wechat-webhook-url').value = config.wechat_app.webhook_url || '';
        }

    } catch (error) {
        message.textContent = '加载配置失败！';
        message.className = 'error-message';
    }

    // 保存配置
    document.getElementById('save-btn').addEventListener('click', async () => {
        try {
            let bucketPaymentDates;
            try {
                const paymentDatesValue = document.getElementById('obs-bucket-payment-dates').value;
                bucketPaymentDates = paymentDatesValue ? JSON.parse(paymentDatesValue) : {};
            } catch (e) {
                message.textContent = '桶包年到期日JSON格式错误，请检查！';
                message.className = 'error-message';
                return;
            }

            const configToSave = {
                obs_config: {
                    access_key: document.getElementById('obs-access-key').value.trim(),
                    secret_key: document.getElementById('obs-secret-key').value.trim(),
                    region: document.getElementById('obs-region').value.trim(),
                    special_buckets: document.getElementById('obs-special-buckets').value.split(',').map(s => s.trim()).filter(Boolean),
                    bucket_schedules: document.getElementById('obs-bucket-schedules').value.split(',').map(s => s.trim()).filter(Boolean),
                    bucket_payment_dates: bucketPaymentDates
                },
                wechat_app: {
                    webhook_url: document.getElementById('wechat-webhook-url').value.trim()
                }
            };

            const response = await fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(configToSave)
            });

            if (response.status === 401 || response.status === 400) {
                window.location.href = '/login';
                return;
            }

            const result = await response.json();
            if (response.ok && result.success) {
                message.textContent = '保存成功！';
                message.className = 'success-message';
            } else {
                message.textContent = result.message || '保存失败！';
                message.className = 'error-message';
            }

        } catch (error) {
            message.textContent = '发生网络错误，保存失败！';
            message.className = 'error-message';
        }
    });
});
