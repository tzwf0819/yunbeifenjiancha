const fs = require('fs');
const path = require('path');
const obsService = require('./obs.service');
const configService = require('./config.service');

const STATUS_FILE_PATH = path.join(__dirname, '../status.json');
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const evaluatePaymentStatus = (task, now) => {
    if (!task.requires_payment) return null;
    if (!task.payment_due_date) {
        return `任务【${task.name}】未配置缴费到期日`;
    }
    const dueDate = new Date(task.payment_due_date);
    if (Number.isNaN(dueDate.getTime())) {
        return `任务【${task.name}】的缴费到期日格式无效 (${task.payment_due_date})`;
    }
    if (now <= dueDate) {
        return null;
    }
    const overdueDays = Math.ceil((now - dueDate) / DAY_IN_MS);
    return `任务【${task.name}】缴费逾期 ${overdueDays} 天`;
};

const buildResultRecord = (task, db, backupResult) => ({
    task_name: task.name,
    task_id: task.id,
    db_name: db.name,
    status: backupResult.status,
    reason: backupResult.reason,
    latest_file_name: backupResult.latest_file_name,
    latest_time: backupResult.latest_time,
    expected_slots: backupResult.expected_slots,
    missing_slots: backupResult.missing_slots,
    requires_payment: Boolean(task.requires_payment),
    payment_due_date: task.payment_due_date || null,
    retention_count: db.retention_count
});

/**
 * 执行一次完整的状态检查（包括清理），并保存结果到 status.json
 */
const runCheckAndSave = async () => {
    console.log('[状态服务] 开始执行完整巡检并保存状态...');
    const config = await configService.loadConfig(); // [云原生配置] 异步加载
    const bucketName = config.huawei_obs.bucket_name;
    const now = new Date();

    if (!bucketName) {
        console.warn('[状态服务] OBS存储桶名称未配置，跳过巡检。');
        const emptyStatus = { review_results: [], payment_warnings: [], last_updated: new Date().toLocaleString('zh-CN') };
        fs.writeFileSync(STATUS_FILE_PATH, JSON.stringify(emptyStatus, null, 4));
        return emptyStatus;
    }

    const obsClient = obsService.getObsClient(config.huawei_obs);
    const review_results = [];
    const paymentWarnings = [];

    for (const task of config.tasks) {
        const paymentIssue = evaluatePaymentStatus(task, now);
        if (paymentIssue) {
            paymentWarnings.push(paymentIssue);
        }

        for (const db of task.databases) {
            if (!db.name) {
                review_results.push({
                    task_name: task.name,
                    task_id: task.id,
                    db_name: '未命名数据库',
                    status: '异常',
                    reason: '数据库名称缺失',
                    latest_file_name: 'N/A',
                    latest_time: 'N/A',
                    expected_slots: [],
                    missing_slots: [],
                    requires_payment: Boolean(task.requires_payment),
                    payment_due_date: task.payment_due_date || null,
                    retention_count: db.retention_count
                });
                continue;
            }

            let finalResult;
            try {
                finalResult = await obsService.checkDatabaseBackup(obsClient, bucketName, task, db);
                await obsService.pruneOldBackups(obsClient, bucketName, task, db, db.retention_count);
            } catch (error) {
                console.error(`[状态服务] 检查数据库 ${db.name} 出错:`, error);
                finalResult = {
                    status: '异常',
                    reason: error.message,
                    latest_file_name: 'N/A',
                    latest_time: 'N/A',
                    expected_slots: [],
                    missing_slots: []
                };
            }

            review_results.push(buildResultRecord(task, db, finalResult));
        }
    }

    const newStatus = {
        review_results,
        payment_warnings: paymentWarnings,
        last_updated: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    };

    try {
        fs.writeFileSync(STATUS_FILE_PATH, JSON.stringify(newStatus, null, 4));
        console.log('[状态服务] 成功将最新巡检结果保存到 status.json。');
    } catch (error) {
        console.error('[状态服务] 写入 status.json 文件失败:', error);
    }

    return newStatus;
};

/**
 * [核心修复] 从 status.json 加载最新的巡检状态，并确保返回的结构永远是完整的
 */
const loadStatus = () => {
    const defaultStatus = {
        review_results: [],
        tasks: [], // 确保tasks数组永远存在
        payment_warnings: [],
        last_updated: '从未'
    };

    try {
        if (!fs.existsSync(STATUS_FILE_PATH)) {
            return defaultStatus;
        }

        const data = fs.readFileSync(STATUS_FILE_PATH, 'utf8');
        if (!data) { // 文件存在但内容为空
            return defaultStatus;
        }

        const parsed = JSON.parse(data);
        
        // 确保返回的对象结构永远完整
        return {
            ...defaultStatus,
            ...parsed,
            tasks: parsed.tasks || [], // 即使解析出的对象没有tasks属性，也保证它是个数组
            review_results: parsed.review_results || []
        };

    } catch (error) {
        console.error('[状态服务] 读取或解析 status.json 文件失败:', error);
        return defaultStatus; // 发生任何错误都返回一个安全的默认对象
    }
};

module.exports = { runCheckAndSave, loadStatus };
