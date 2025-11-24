const tcb = require('tcb-admin-node');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-super-secret-jwt-key-that-is-long-and-random'; 
const CONFIG_ID = 'default_config'; // 我们在数据库中只存一条配置记录

exports.main = async (event, context) => {
    // 初始化TCB
    const app = tcb.init({ env: tcb.getCurrentEnv().envId });
    const db = app.database();
    const configCollection = db.collection('system_config');

    // 验证JWT
    const token = event.headers.authorization?.split(' ')[1];
    if (!token) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized: No token provided' }) };
    }

    try {
        jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return { statusCode: 401, body: JSON.stringify({ message: 'Unauthorized: Invalid token' }) };
    }

    if (event.httpMethod === 'GET') {
        // 获取配置
        const config = await configCollection.doc(CONFIG_ID).get();
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config.data[0] || {})
        };
    } else if (event.httpMethod === 'POST') {
        // 更新配置
        const newConfig = JSON.parse(event.body);
        await configCollection.doc(CONFIG_ID).set(newConfig);
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: '配置已更新' })
        };
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
};