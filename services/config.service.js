const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

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
 * 加载配置文件，并从环境变量注入敏感信息
 * @returns {object} 配置对象
 */
const loadConfig = () => {
    let savedConfig;
    if (!fs.existsSync(CONFIG_PATH)) {
        savedConfig = defaultConfig;
    } else {
        try {
            const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
            savedConfig = JSON.parse(fileContent);
        } catch (error) {
            console.error('读取或解析config.json失败:', error);
            savedConfig = defaultConfig;
        }
    }

    // 从环境变量注入敏感信息
    const finalConfig = normalizeConfig(savedConfig);

    finalConfig.huawei_obs.ak = process.env.HUAWEI_OBS_AK || '';
    finalConfig.huawei_obs.sk = process.env.HUAWEI_OBS_SK || '';

    finalConfig.wechat_app.corp_id = process.env.WECHAT_CORP_ID || '';
    finalConfig.wechat_app.agent_id = process.env.WECHAT_AGENT_ID || '';
    finalConfig.wechat_app.secret = process.env.WECHAT_SECRET || '';

    // 为每个任务的数据库注入密码
    finalConfig.tasks.forEach(task => {
        if (task.name && Array.isArray(task.databases)) {
            task.databases.forEach(db => {
                const envVarName = `DB_PASS_${task.name.toUpperCase()}`;
                db.pass = process.env[envVarName] || '';
            });
        }
    });

    return finalConfig;
};

/**
 * 保存配置到文件，并为新任务生成ID和状态
 * @param {object} config - 待保存的配置对象
 */
const saveConfig = (config) => {
    const configToPersist = normalizeConfig(config);
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(configToPersist, null, 2), 'utf8');
    } catch (error) {
        console.error('保存config.json失败:', error);
        throw new Error('无法写入配置文件');
    }
};

module.exports = { loadConfig, saveConfig };
