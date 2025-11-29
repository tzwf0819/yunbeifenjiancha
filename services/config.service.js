const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { ObsClient } = require('esdk-obs-nodejs');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// --- [最终方案] 云端配置的单一事实来源 ---
const CLOUD_CONFIG_BUCKET = 'yidianjicheng-backeup';
const CLOUD_CONFIG_OBJECT_KEY = 'config/config.json';

// 内存中的配置缓存
let memoryCache = null;

// [最终方案] Node.js实现的、核心的下载函数
const downloadConfigFromObs = async () => {
    let obsClient;
    try {
        const ak = process.env.HUAWEI_OBS_AK;
        const sk = process.env.HUAWEI_OBS_SK;
        const server = 'https://obs.cn-north-4.myhuaweicloud.com';

        if (!ak || !sk) {
            throw new Error('环境变量 HUAWEI_OBS_AK 和 HUAWEI_OBS_SK 未设置。');
        }

        console.log('[配置服务-自愈] 正在初始化OBS客户端...');
        obsClient = new ObsClient({ access_key_id: ak, secret_access_key: sk, server });

        console.log(`[配置服务-自愈] 正在从OBS下载配置文件: ${CLOUD_CONFIG_BUCKET}/${CLOUD_CONFIG_OBJECT_KEY}`)
        const resp = await obsClient.getObject({
            Bucket: CLOUD_CONFIG_BUCKET,
            Key: CLOUD_CONFIG_OBJECT_KEY,
            SaveToFile: CONFIG_PATH 
        });

        if (resp.CommonMsg.Status >= 300) {
            throw new Error(`OBS下载失败，状态码: ${resp.CommonMsg.Status}, 消息: ${resp.CommonMsg.Message}`);
        }

        console.log('[配置服务-自愈] 成功从OBS下载并保存了最新的配置文件。');
        return true;

    } catch (error) {
        console.error('[配置服务-自愈] 从OBS下载配置文件时发生严重错误:', error);
        return false;
    } finally {
        if (obsClient) {
            obsClient.close();
        }
    }
};

// --- 标准化逻辑 (保持不变) ---
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

// [最终方案] “自愈式”的配置加载函数
const loadConfig = async () => {
    if (memoryCache) {
        return memoryCache;
    }

    let configData;
    try {
        const fileContent = await fs.readFile(CONFIG_PATH, 'utf8');
        if (!fileContent) throw new Error('配置文件为空。');
        configData = JSON.parse(fileContent);
        console.log('[配置服务] 成功从本地加载配置文件。');
    } catch (localError) {
        console.warn(`[配置服务] 从本地加载配置失败: ${localError.message}`);
        console.log('[配置服务] 启动“自愈”流程，尝试从OBS下载...');
        
        const downloadSuccess = await downloadConfigFromObs();
        
        if (downloadSuccess) {
            try {
                const fileContent = await fs.readFile(CONFIG_PATH, 'utf8');
                configData = JSON.parse(fileContent);
            } catch (retryError) {
                console.error('[配置服务] 下载后重试加载依然失败，将使用默认空配置:', retryError);
                configData = defaultConfig;
            }
        } else {
            console.error('[配置服务] “自愈”流程失败，将使用默认空配置。');
            configData = defaultConfig;
        }
    }

    const finalConfig = normalizeConfig(configData);

    // 环境变量注入 (保持不变)
    finalConfig.huawei_obs.ak = process.env.HUAWEI_OBS_AK || '';
    finalConfig.huawei_obs.sk = process.env.HUAWEI_OBS_SK || '';
    finalConfig.wechat_app.corp_id = process.env.WECHAT_CORP_ID || '';
    finalConfig.wechat_app.agent_id = process.env.WECHAT_AGENT_ID || '';
    finalConfig.wechat_app.secret = process.env.WECHAT_SECRET || '';

    memoryCache = finalConfig;
    return finalConfig;
};

// [最终方案] 保存配置到本地和云端
const saveConfig = async (config) => {
    const configToPersist = normalizeConfig(config);
    memoryCache = configToPersist;
    await fs.writeFile(CONFIG_PATH, JSON.stringify(configToPersist, null, 2), 'utf8');

    // 异步上传到OBS (无需等待，在后台执行)
    (async () => {
        let obsClient;
        try {
            const ak = configToPersist.huawei_obs.ak || process.env.HUAWEI_OBS_AK;
            const sk = configToP sist.huawei_obs.sk || process.env.HUAWEI_OBS_SK;

            if (!ak || !sk) {
                console.warn('[配置服务-保存] 无法获取OBS凭证，跳过上传。');
                return;
            }

            obsClient = new ObsClient({ access_key_id: ak, secret_access_key: sk, server: 'https://obs.cn-north-4.myhuaweicloud.com' });
            const resp = await obsClient.putFile({
                Bucket: CLOUD_CONFIG_BUCKET,
                Key: CLOUD_CONFIG_OBJECT_KEY,
                SourceFile: CONFIG_PATH
            });
            if (resp.CommonMsg.Status < 300) {
                console.log('[配置服务-保存] 成功将配置同步到云端。');
            } else {
                throw new Error(`OBS上传失败，状态码: ${resp.CommonMsg.Status}`);
            }
        } catch (error) {
            console.error('[配置服务-保存] 同步配置到云端时出错:', error);
        } finally {
            if (obsClient) obsClient.close();
        }
    })();
};

module.exports = { loadConfig, saveConfig };
