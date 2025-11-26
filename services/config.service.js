const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const defaultConfig = {
    huawei_obs: { ak: '', sk: '', endpoint: '', bucket_name: '' },
    wechat_app: { corp_id: '', agent_id: '', secret: '', touser: '' },
    tasks: []
};

/**
 * 加载配置文件
 * @returns {object} 配置对象
 */
const loadConfig = () => {
    if (!fs.existsSync(CONFIG_PATH)) return defaultConfig;
    try {
        const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
        // 合并默认值以确保新字段存在
        const savedConfig = JSON.parse(fileContent);
        return {
            ...defaultConfig,
            ...savedConfig,
            tasks: savedConfig.tasks || []
        };
    } catch (error) {
        console.error('读取或解析config.json失败:', error);
        return defaultConfig;
    }
};

/**
 * 保存配置到文件，并为新任务生成ID和状态
 * @param {object} config - 待保存的配置对象
 */
const saveConfig = (config) => {
    // 确保tasks字段存在
    if (!config.tasks) {
        config.tasks = [];
    }

    // 为没有ID的新任务生成ID和初始化状态
    config.tasks.forEach(task => {
        if (!task.id) {
            task.id = crypto.randomBytes(8).toString('hex'); // 生成一个16字符的安全随机ID
            task.emergency_backup = 'idle'; // idle, pending, completed
        }
    });

    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
        console.error('保存config.json失败:', error);
        throw new Error('无法写入配置文件');
    }
};

module.exports = { loadConfig, saveConfig };
