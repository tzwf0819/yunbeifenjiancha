
document.getElementById('login-btn').addEventListener('click', async () => {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            localStorage.setItem('authToken', result.token);
            window.location.href = '/config';
        } else {
            errorMessage.textContent = result.message || '登录失败';
        }
    } catch (error) {
        errorMessage.textContent = '发生网络错误，请稍后重试。';
    }
});
