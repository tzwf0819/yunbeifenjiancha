const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// [回滚] 只使用本地的、同步的config.json
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// 内存缓存
let memoryCache = null;

const defaultConfig = {
    huawei_obs: { ak: '', sk: '', endpoint: '', bucket_name: '' },
    wechat_app: { corp_id: '', agent_id: '', secret: '', touser: '' },
    tasks: []
};

const normalizeDatabaseConfig = (database = {}) => ({...database, retention_count: parseInt(database.retention_count, 10) || 0});
const normalizeTaskConfig = (task = {}) => {
    const normalized = { ...task };
    normalized.databases = Array.isArray(task.databases) ? task.databases.map(normalizeDatabaseConfig) : [];
    if (!normalized.id) normalized.id = crypto.randomUUID();
    if (!normalized.emergency_backup) normalized.emergency_backup = 'idle';
    if (typeof normalized.requires_payment !== 'boolean') normalized.requires_payment = false;
    if (typeof normalized.last_error === 'undefined') normalized.last_error = null;
    if (!normalized.last_status_update) normalized.last_status_update = new Date().toISOString();
    if (!normalized.folder) normalized.folder = '';
    return normalized;
};
const normalizeConfig = (config = defaultConfig) => ({...defaultConfig, ...config, tasks: Array.isArray(config.tasks) ? config.tasks.map(normalizeTaskConfig) : []});

// [回滚] 最简单的同步加载逻辑
const loadConfig = () => {
    if (memoryCache) {
        return memoryCache;
    }

    let configData;
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            throw new Error('config.json not found');
        }
        const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
        if (!fileContent) throw new Error('config.json is empty');
        configData = JSON.parse(fileContent);
    } catch (error) {
        console.error(`[配置服务] 加载本地config.json失败: ${error.message}。将使用默认空配置。`);
        configData = defaultConfig;
    }

    const finalConfig = normalizeConfig(configData);

    finalConfig.huawei_obs.ak = process.env.HUAWEI_OBS_AK || '';
    finalConfig.huawei_obs.sk = process.env.HUAWEI_OBS_SK || '';
    finalConfig.wechat_app.corp_id = process.env.WECHAT_CORP_ID || '';
    finalConfig.wechat_app.agent_id = process.env.WECHAT_AGENT_ID || '';
    finalConfig.wechat_app.secret = process.env.WECHAT_SECRET || '';

    memoryCache = finalConfig;
    return finalConfig;
};

// [回滚] 最简单的同步保存逻辑
const saveConfig = (config) => {
    const configToPersist = normalizeConfig(config);
    memoryCache = configToPersist;
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(configToPersist, null, 2), 'utf8');
    } catch (error) {
        console.error('保存config.json到本地失败:', error);
        throw error;
    }
};

module.exports = { loadConfig, saveConfig };
