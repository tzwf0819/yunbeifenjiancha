const express = require('express');
const mustacheExpress = require('mustache-express');
const bodyParser = require('body-parser');
const schedule = require('node-schedule');
const path = require('path');

// --- 模块化导入 ---
const configService = require('./services/config.service');
const statusController = require('./controllers/status.controller');
const taskRoutes = require('./routes/task.routes');
const { webAuth } = require('./middleware/auth.middleware');

const app = express();
const PORT = process.env.PORT || 3001;

// --- 认证信息 (保持不变) ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'yida';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'shaoyansa';
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret';

// --- 模板引擎与中间件 ---
app.engine('html', mustacheExpress());
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- 路由 --- //

// 辅助函数：按任务名称对巡检结果进行分组
const groupResultsByTask = (results) => {
    if (!results || results.length === 0) return [];
    const grouped = results.reduce((acc, current) => {
        if (!acc[current.task_name]) {
            acc[current.task_name] = { task_name: current.task_name, results: [] };
        }
        acc[current.task_name].results.push(current);
        return acc;
    }, {});
    return Object.values(grouped);
};

// 页面路由
app.get('/', (req, res) => res.redirect('/dashboard'));
app.get('/login', (req, res) => res.render('login'));
app.get('/config', (req, res) => res.render('config'));
app.get('/dashboard', async (req, res) => {
    try {
        const data = await statusController.getFullStatus();
        res.render('dashboard', { 
            last_updated: data.last_updated,
            grouped_results: groupResultsByTask(data.review_results)
        });
    } catch (error) {
        res.status(500).render('error', { message: `加载仪表盘失败: ${error.message}` });
    }
});

// --- API 路由 ---

// 1. 新的任务专用路由
app.use('/api/tasks', taskRoutes);

// 2. 登录和全局配置路由 (保留)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const jwt = require('jsonwebtoken');
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
});

app.get('/api/config', webAuth, (req, res) => {
    res.json(configService.loadConfig());
});

app.post('/api/config', webAuth, (req, res) => {
    try {
        configService.saveConfig(req.body);
        res.json({ success: true, message: '配置保存成功！' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 3. 手动巡检路由 (保留)
app.post('/api/run-check', webAuth, async (req, res) => {
    console.log(`[${new Date().toLocaleString()}] 手动触发巡检任务...`);
    try {
        await statusController.runScheduledReport();
        res.json({ success: true, message: '巡检报告已成功触发发送！' });
    } catch (error) {
        res.status(500).json({ success: false, message: `巡检失败: ${error.message}` });
    }
});

// --- 定时任务 (保留) ---
schedule.scheduleJob('30 8 * * *', async () => {
    console.log(`[${new Date().toLocaleString()}] 开始执行每日OBS报告定时任务...`);
    await statusController.runScheduledReport();
});

// --- 服务器启动 ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`服务器在端口 ${PORT} 上成功启动，已加载新的任务API路由。`);
    console.log('每日报告任务已计划在 08:30 执行。');
});
