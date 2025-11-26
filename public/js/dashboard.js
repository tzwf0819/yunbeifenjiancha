document.addEventListener('DOMContentLoaded', () => {
    const runCheckBtn = document.getElementById('run-check-btn');
    const message = document.getElementById('message');
    const token = localStorage.getItem('authToken');

    if (runCheckBtn) {
        runCheckBtn.addEventListener('click', async () => {
            if (!token) {
                alert('认证信息已过期，请重新登录。');
                return window.location.href = '/login';
            }

            runCheckBtn.disabled = true;
            runCheckBtn.textContent = '正在巡检中...';
            message.textContent = '手动巡检任务已触发，请稍候...';
            message.style.color = '#3498db';

            try {
                const response = await fetch('/api/run-check', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    message.textContent = '巡检请求成功，正在刷新页面...';
                    message.style.color = '#2ecc71';
                    // 延迟刷新以显示成功信息
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    throw new Error(result.message || '未知错误');
                }

            } catch (error) {
                message.textContent = `操作失败: ${error.message}`;
                message.style.color = '#e74c3c';
                runCheckBtn.disabled = false;
                runCheckBtn.textContent = '立即手动巡检';
            }
        });
    }
});
