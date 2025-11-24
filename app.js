const express = require('express');
const mustacheExpress = require('mustache-express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const schedule = require('node-schedule');
const path = require('path');
const core = require('./core-logic');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'yida';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'shaoyansa';

app.engine('html', mustacheExpress());
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render('login'));

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
});

const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Access Denied'});
    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        res.status(400).json({ message: 'Invalid Token' });
    }
};

app.get('/config', (req, res) => res.render('config'));

app.get('/api/config', authMiddleware, (req, res) => {
    res.json(core.loadConfig());
});

app.post('/api/config', authMiddleware, (req, res) => {
    try {
        core.saveConfig(req.body);
        res.json({ success: true, message: '配置保存成功！' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 新增：手动触发巡检的API
app.post('/api/run-check', authMiddleware, async (req, res) => {
    try {
        console.log(`[${new Date().toLocaleString()}] 手动触发巡检任务...`);
        await core.runScheduledReport();
        res.json({ success: true, message: '巡检报告已成功发送！' });
    } catch (error) {
        console.error('手动巡检失败:', error);
        res.status(500).json({ success: false, message: `巡检失败: ${error.message}` });
    }
});

app.get('/dashboard', async (req, res) => {
    try {
        const data = await core.getBucketStatus();
        res.render('dashboard', data);
    } catch (error) {
        res.status(500).render('error', { message: error.message });
    }
});

schedule.scheduleJob('30 8 * * *', async () => {
    console.log(`[${new Date().toLocaleString()}] 执行每日OBS报告任务...`);
    try {
        await core.runScheduledReport();
    } catch (error) {
        console.error('每日报告任务执行失败:', error);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`服务器在端口 ${PORT} 上监听...`);
});