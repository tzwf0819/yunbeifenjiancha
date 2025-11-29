const fs = require('fs').promises; // 使用 fs.promises API
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// --- [核心修复] 文件锁，防止并发读写问题 ---
let isLocked = false;

const defaultConfig = {
    huawei_obs: { ak: '', sk: '', endpoint: '', bucket_name: '' },
    wechat_app: { corp_id: '', agent_id: '', secret: '', touser: '' },
    tasks: []
};

const normalizeDatabaseConfig = (database = {}) => ({
    ...database,
    retention_count: typeof database.retention_count === 'number'
        ? database.retention_count
        : parseInt(database.retention_count, 10) || 0
});

const normalizeTaskConfig = (task = {}) => {
    const normalized = { ...task };
    normalized.databases = Array.isArray(task.databases)
        ? task.databases.map(normalizeDatabaseConfig)
        : [];

    if (!normalized.id) {
        normalized.id = crypto.randomUUID();
    }

    if (!normalized.emergency_backup) {
        normalized.emergency_backup = 'idle';
    }

    if (typeof normalized.requires_payment !== 'boolean') {
        normalized.requires_payment = false;
    }

    if (typeof normalized.last_error === 'undefined') {
        normalized.last_error = null;
    }

    if (!normalized.last_status_update) {
        normalized.last_status_update = new Date().toISOString();
    }

    if (!normalized.folder) {
        normalized.folder = '';
    }

    return normalized;
};

const normalizeConfig = (config = defaultConfig) => ({
    ...defaultConfig,
    ...config,
    tasks: Array.isArray(config.tasks) ? config.tasks.map(normalizeTaskConfig) : []
});

/**
 * [已重构] 异步加载配置文件，并从环境变量注入敏感信息
 * @returns {Promise<object>} 配置对象
 */
const loadConfig = async () => {
    if (isLocked) {
        console.warn('Config file is locked, retrying in 100ms...');
        await new Promise(resolve => setTimeout(resolve, 100));
        return loadConfig(); // 递归调用以重试
    }

    isLocked = true;
    let savedConfig;

    try {
        await fs.access(CONFIG_PATH);
        const fileContent = await fs.readFile(CONFIG_PATH, 'utf8');
        savedConfig = JSON.parse(fileContent);
    } catch (error) {
        if (error.code === 'ENOENT') { // 文件不存在
            console.log('config.json not found, using default config.');
            savedConfig = defaultConfig;
        } else { // 其他错误 (如解析失败)
            console.error('读取或解析config.json失败，将使用默认配置:', error);
            savedConfig = defaultConfig;
        }
    } finally {
        isLocked = false;
    }

    const finalConfig = normalizeConfig(savedConfig);

    finalConfig.huawei_obs.ak = process.env.HUAWEI_OBS_AK || '';
    finalConfig.huawei_obs.sk = process.env.HUAWEI_OBS_SK || '';

    finalConfig.wechat_app.corp_id = process.env.WECHAT_CORP_ID || '';
    finalConfig.wechat_app.agent_id = process.env.WECHAT_AGENT_ID || '';
    finalConfig.wechat_app.secret = process.env.WECHAT_SECRET || '';

    return finalConfig;
};

/**
 * [已重构] 异步保存配置到文件，并为新任务生成ID和状态
 * @param {object} config - 待保存的配置对象
 * @returns {Promise<void>}
 */
const saveConfig = async (config) => {
    if (isLocked) {
        console.warn('Config file is locked, retrying in 100ms...');
        await new Promise(resolve => setTimeout(resolve, 100));
        return saveConfig(config); // 递归调用以重试
    }

    isLocked = true;
    try {
        const configToPersist = normalizeConfig(config);
        await fs.writeFile(CONFIG_PATH, JSON.stringify(configToPersist, null, 2), 'utf8');
    } catch (error) {
        console.error('保存config.json失败:', error);
        throw new Error('无法写入配置文件');
    } finally {
        isLocked = false;
    }
};
module.exports = { loadConfig, saveConfig };
