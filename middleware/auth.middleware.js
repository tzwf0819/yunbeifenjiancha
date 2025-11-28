const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret';
const AUTH_COOKIE_NAME = 'obsAuthToken';

const parseCookieHeader = (cookieHeader = '') => {
    return cookieHeader.split(';').reduce((accumulator, pair) => {
        const [rawKey, ...rawValue] = pair.split('=');
        if (!rawKey) {
            return accumulator;
        }
        const key = rawKey.trim();
        const value = rawValue.join('=').trim();
        if (!key) {
            return accumulator;
        }
        accumulator[key] = decodeURIComponent(value || '');
        return accumulator;
    }, {});
};

const extractTokenFromRequest = (req) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        if (token) {
            return token;
        }
    }

    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        const cookies = parseCookieHeader(cookieHeader);
        if (cookies[AUTH_COOKIE_NAME]) {
            return cookies[AUTH_COOKIE_NAME];
        }
    }

    return null;
};

const respondUnauthorized = (req, res, message) => {
    const acceptHeader = req.headers.accept || '';
    const wantsHTML = acceptHeader.includes('text/html');

    if (wantsHTML && req.method === 'GET') {
        return res.redirect('/login');
    }

    return res.status(401).json({ message });
};

/**
 * 验证Web前端用户的JWT Token (更健壮的版本)
 */
const webAuth = (req, res, next) => {
    try {
        const token = extractTokenFromRequest(req);

        if (!token) {
            return respondUnauthorized(req, res, 'Access Denied: Missing authentication token.');
        }

        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                return respondUnauthorized(req, res, 'Invalid or expired token.');
            }
            req.user = user;
            return next();
        });

    } catch (error) {
        return respondUnauthorized(req, res, 'Bad Request: An unexpected error occurred while processing authentication.');
    }
};

module.exports = { webAuth, AUTH_COOKIE_NAME };
