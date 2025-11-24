const jwt = require('jsonwebtoken');

// 实际项目中，JWT密钥应该从环境变量中获取，以确保安全
const JWT_SECRET = 'your-super-secret-jwt-key-that-is-long-and-random'; 
const ADMIN_USERNAME = 'yida';
const ADMIN_PASSWORD = 'shaoyansa';

exports.main = async (event, context) => {
    const { username, password } = JSON.parse(event.body);

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        // 登录成功，生成一个JWT Token
        const token = jwt.sign({ username: username, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
        
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, token: token })
        };
    } else {
        // 登录失败
        return {
            statusCode: 401,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, message: '用户名或密码错误' })
        };
    }
};