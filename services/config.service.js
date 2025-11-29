const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const axios = require('axios'); // 引入 axios 用于下载
const { getObsClient } = require('./obs.service'); // 引入 OBS 服务用于上传

// --- [核心改造] 云端配置的单一事实来源 (Single Source of Truth) ---
const CLOUD_CONFIG_URL = 'https://yidianjicheng-backeup.obs.cn-north-4.myhuaweicloud.com/config/config.json';
const CLOUD_CONFIG_OBJECT_KEY = 'config/config.json'; // OBS对象键

// 本地缓存路径，作为网络失败时的安全回退
const LOCAL_CACHE_PATH = path.join(__dirname, '..', 'config.cache.json');

// 内存中的配置缓存，避免重复的文件IO
let memoryCache = null;

// --- 标准化逻辑 (保持不变) ---
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

// [核心改造] 从云端加载配置，带本地缓存和失败回退
const loadConfig = async () => {
    if (memoryCache) {
        return memoryCache;
    }

    let configData;
    try {
        console.log(`[配置服务] 尝试从云端加载配置: ${CLOUD_CONFIG_URL}`);
        const response = await axios.get(CLOUD_CONFIG_URL, { timeout: 10000 });
        configData = response.data;
        console.log('[配置服务] 成功从云端加载配置，正在更新本地缓存...');
        await fs.writeFile(LOCAL_CACHE_PATH, JSON.stringify(configData, null, 2), 'utf8');
    } catch (cloudError) {
        console.warn(`[配置服务] 从云端加载配置失败: ${cloudError.message}`);
        console.log('[配置服务] 正在尝试从本地缓存加载...');
        try {
            const cachedContent = await fs.readFile(LOCAL_CACHE_PATH, 'utf8');
            configData = JSON.parse(cachedContent);
            console.log('[配置服务] 成功从本地缓存加载配置。');
        } catch (cacheError) {
            console.error(`[配置服务] 从本地缓存加载也失败: ${cacheError.message}`);
            console.log('[配置服务] 将使用默认的空配置。');
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

// [核心改造] 保存配置到本地缓存和云端
const saveConfig = async (config) => {
    const configToPersist = normalizeConfig(config);
    
    // 1. 更新内存缓存
    memoryCache = configToPersist;

    // 2. 异步写入本地缓存
    const writeToCachePromise = fs.writeFile(LOCAL_CACHE_PATH, JSON.stringify(configToPersist, null, 2), 'utf8');

    // 3. 异步上传到OBS
    const uploadToCloudPromise = (async () => {
        try {
            const obsClient = getObsClient(configToPersist.huawei_obs);
            const bucketName = configToPersist.huawei_obs.bucket_name;

            if (!bucketName) {
                throw new Error('OBS存储桶名称未在配置中提供。');
            }
            
            // OBS SDK 需要一个本地文件路径来上传，所以我们先确保本地缓存已写入
            await writeToCachePromise; 

            console.log(`[配置服务] 准备将最新配置上传到OBS: ${bucketName}/${CLOUD_CONFIG_OBJECT_KEY}`);
            const resp = await obsClient.putFile(bucketName, CLOUD_CONFIG_OBJECT_KEY, LOCAL_CACHE_PATH);

            if (resp.CommonMsg.Status < 300) {
                console.log('[配置服务] 成功将配置同步到云端。');
            } else {
                throw new Error(`OBS返回错误: ${resp.CommonMsg.Status}`);
            }
        } catch (error) {
            console.error(`[配置服务] 同步配置到云端失败:`, error);
            // 即使上传失败，也不应该阻塞用户的保存操作，因为本地缓存已经成功
        }
    })();

    // 等待两个异步操作完成
    try {
        await Promise.all([writeToCachePromise, uploadToCloudPromise]);
    } catch (error) {
        // 主要捕获本地写入失败的错误
        console.error('保存配置到本地缓存时发生严重错误:', error);
        throw new Error('无法写入本地配置文件缓存');
    }
};

module.exports = { loadConfig, saveConfig };
