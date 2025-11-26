const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret';
const BACKUP_SERVICE_API_KEY = process.env.BACKUP_SERVICE_API_KEY || 'default-backup-service-key';

/**
 * 验证Web前端用户的JWT Token
 */
const webAuth = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Access Denied: No Token Provided' });
    }
    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid Token' });
    }
};

/**
 * 验证Python备份客户端的API Key
 */
const serviceAuth = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === BACKUP_SERVICE_API_KEY) {
        next();
    } else {
        res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
    }
};

module.exports = { webAuth, serviceAuth };
