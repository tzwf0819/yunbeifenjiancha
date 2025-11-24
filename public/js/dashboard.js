
document.addEventListener('DOMContentLoaded', () => {
    const runCheckBtn = document.getElementById('run-check-btn');
    const message = document.getElementById('message');
    const token = localStorage.getItem('authToken');

    if (runCheckBtn) {
        runCheckBtn.addEventListener('click', async () => {
            if (!token) {
                window.location.href = '/login';
                return;
            }

            message.textContent = '正在触发巡检，请稍候...';
            message.className = '';
            runCheckBtn.disabled = true;

            try {
                const response = await fetch('/api/run-check', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                const result = await response.json();

                if (result.success) {
                    message.textContent = '巡检任务已成功触发，报告将发送到企业微信。正在刷新页面...';
                    message.className = 'success-message';
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    throw new Error(result.message || '巡检触发失败');
                }

            } catch (error) {
                message.textContent = `操作失败: ${error.message}`;
                message.className = 'error-message';
                runCheckBtn.disabled = false;
            }
        });
    }
});
