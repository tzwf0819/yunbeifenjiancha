require('dotenv').config();

const express = require('express');
const mustacheExpress = require('mustache-express');
const schedule = require('node-schedule');
const path = require('path');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');

// --- 全新的模块化导入 ---
const statusService = require('./services/status.service');
const wechatService = require('./services/wechat.service');
const apiRoutes = require('./routes/api.routes');
const { webAuth, AUTH_COOKIE_NAME } = require('./middleware/auth.middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 认证信息 (保持不变) ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'yida';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'shaoyansa';
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret';
const TOKEN_TTL_HOURS = 8;
const COOKIE_MAX_AGE = TOKEN_TTL_HOURS * 60 * 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const signAuthToken = (username) => jwt.sign({ username }, JWT_SECRET, { expiresIn: `${TOKEN_TTL_HOURS}h` });

const attachAuthCookie = (res, token) => {
    res.cookie(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // 在生产环境下也允许HTTP设置Cookie
        maxAge: COOKIE_MAX_AGE
    });
};

// --- 模板引擎与中间件 ---
app.engine('html', mustacheExpress());
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));


// --- 页面路由 ---

// 辅助函数：按任务名称对巡检结果进行分组 (保持不变)
const groupResultsByTask = (results) => {
    if (!results || !Array.isArray(results)) return [];
    const grouped = results.reduce((acc, current) => {
        const key = current.task_id;
        if (!key) return acc;
        if (!acc[key]) {
            acc[key] = {
                task_name: current.task_name,
                task_id: current.task_id,
                requires_payment: current.requires_payment,
                payment_due_date: current.payment_due_date,
                results: []
            };
        }
        acc[key].results.push(current);
        return acc;
    }, {});
    return Object.values(grouped);
};

app.get('/', (req, res) => res.redirect('/dashboard'));
app.get('/login', (req, res) => res.render('login'));
app.get('/config', webAuth, (req, res) => res.render('config')); // config页面需要认证

// [已重构] Dashboard 路由
app.get('/dashboard', webAuth, (req, res) => {
    try {
        const data = statusService.loadStatus(); // 直接从服务加载数据
        const groupedResults = groupResultsByTask(data.review_results);
        const paymentWarnings = data.payment_warnings || [];
        res.render('dashboard', { 
            last_updated: data.last_updated,
            grouped_results: groupedResults,
            payment_warnings: paymentWarnings,
            has_payment_warnings: paymentWarnings.length > 0
        });
    } catch (error) {
        res.status(500).render('error', { message: `加载仪表盘失败: ${error.message}` });
    }
});

// --- API 路由 [已重构] ---
app.use('/api', apiRoutes);

// 登录接口：同时兼容旧路径 /login-api 和 RESTful 路径 /api/login
const handleLogin = (req, res) => {
    const { username, password } = req.body || {};

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = signAuthToken(username);
        attachAuthCookie(res, token);
        return res.json({ success: true, token });
    }

    return res.status(401).json({ success: false, message: '用户名或密码错误' });
};

app.post(['/api/login', '/login-api'], handleLogin);

// --- 定时任务 [已重构] ---
// 创建一个定时规则，并明确指定时区为亚洲/上海 (UTC+8)
const dailyRule = new schedule.RecurrenceRule();
dailyRule.hour = 8;
dailyRule.minute = 30; // 用户期望的 8:30
dailyRule.tz = 'Asia/Shanghai';

schedule.scheduleJob(dailyRule, async () => {
    console.log(`[定时任务] 开始执行每日巡检...`);
    try {
        const newStatus = await statusService.runCheckAndSave();
        const hasErrors = newStatus.review_results.some(r => r.status === '异常');
        const hasPaymentWarnings = (newStatus.payment_warnings || []).length > 0;
        if (hasErrors || hasPaymentWarnings) {
            await wechatService.sendAbnormalNotification(newStatus.review_results, { paymentWarnings: newStatus.payment_warnings });
        } else {
            await wechatService.sendNormalNotification('每日巡检完成，所有备份与缴费均正常。');
        }
    } catch (error) {
        console.error('[定时任务] 每日巡检失败:', error);
        await wechatService.sendAbnormalNotification([{ reason: `巡检任务本身失败: ${error.message}` }]);
    }
});

// --- 服务器启动 ---
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`服务器在端口 ${PORT} 上成功启动。`);
    console.log('每日报告任务已计划在 08:30 (北京时间) 执行。');
    console.log('服务器启动，立即执行一次初始巡检...');
    statusService.runCheckAndSave().catch(err => console.error('初始巡检失败:', err));
});

// 优雅关停 (保持不变)
// ...
