
document.addEventListener('DOMContentLoaded', async () => {
    const configTextarea = document.getElementById('config-json');
    const saveBtn = document.getElementById('save-btn');
    const message = document.getElementById('message');
    const token = localStorage.getItem('authToken');

    if (!token) {
        window.location.href = '/login';
        return;
    }

    // 加载配置
    try {
        const response = await fetch('/api/config', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401 || response.status === 400) {
            window.location.href = '/login';
            return;
        }
        const config = await response.json();
        configTextarea.value = JSON.stringify(config, null, 2);
    } catch (error) {
        message.textContent = '加载配置失败！';
        message.className = 'error-message';
    }

    // 保存配置
    saveBtn.addEventListener('click', async () => {
        try {
            let configToSave;
            try {
                configToSave = JSON.parse(configTextarea.value);
            } catch (e) {
                message.textContent = 'JSON格式错误，请检查！';
                message.className = 'error-message';
                return;
            }

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
