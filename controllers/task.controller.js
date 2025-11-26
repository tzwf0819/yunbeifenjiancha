const configService = require('../services/config.service');

// 这是一个简单的内存状态存储，用于跟踪紧急备份的状态
// 在生产环境中，您可能会希望使用更持久的存储，如Redis或数据库
const emergencyStatusStore = new Map();

/**
 * 获取单个任务的配置信息 (供Python客户端使用)
 */
const getTaskConfigById = (req, res) => {
    const { id } = req.params;
    const config = configService.loadConfig();
    const task = config.tasks.find(t => t.id === id);

    if (task) {
        res.json(task);
    } else {
        res.status(404).json({ message: '未找到具有该ID的任务' });
    }
};

/**
 * 触发一个任务的紧急备份
 */
const triggerEmergencyBackup = (req, res) => {
    const { id } = req.params;
    const config = configService.loadConfig();
    const taskIndex = config.tasks.findIndex(t => t.id === id);

    if (taskIndex === -1) {
        return res.status(404).json({ message: '未找到任务' });
    }

    // 检查是否已经在执行中
    if (config.tasks[taskIndex].emergency_backup === 'pending') {
        return res.status(409).json({ message: '该任务的紧急备份已在进行中，请勿重复触发' });
    }

    config.tasks[taskIndex].emergency_backup = 'pending';
    configService.saveConfig(config);
    
    // 设置状态超时，防止客户端一直处于pending状态
    setTimeout(() => {
        const currentConfig = configService.loadConfig();
        const task = currentConfig.tasks.find(t => t.id === id);
        if (task && task.emergency_backup === 'pending') {
            task.emergency_backup = 'idle'; // 超时后重置
            configService.saveConfig(currentConfig);
        }
    }, 300 * 1000); // 5分钟超时

    res.status(202).json({ message: '紧急备份请求已接受，等待客户端执行' });
};

/**
 * 报告紧急备份已完成 (供Python客户端使用)
 */
const completeEmergencyBackup = (req, res) => {
    const { id } = req.params;
    const config = configService.loadConfig();
    const taskIndex = config.tasks.findIndex(t => t.id === id);

    if (taskIndex === -1) {
        return res.status(404).json({ message: '未找到任务' });
    }

    config.tasks[taskIndex].emergency_backup = 'completed';
    configService.saveConfig(config);
    
    // 标记为completed后，一段时间后自动切换回idle，以便可以再次触发
    setTimeout(() => {
        const currentConfig = configService.loadConfig();
        const task = currentConfig.tasks.find(t => t.id === id);
        if (task && task.emergency_backup === 'completed') {
            task.emergency_backup = 'idle';
            configService.saveConfig(currentConfig);
        }
    }, 60 * 1000); // 1分钟后重置

    res.status(200).json({ message: '状态更新成功' });
};

/**
 * 获取任务的实时状态 (供前端轮询)
 */
const getTaskStatus = (req, res) => {
    const { id } = req.params;
    const config = configService.loadConfig();
    const task = config.tasks.find(t => t.id === id);

    if (task) {
        res.json({ id: task.id, status: task.emergency_backup });
    } else {
        res.status(404).json({ message: '未找到任务' });
    }
};


module.exports = {
    getTaskConfigById,
    triggerEmergencyBackup,
    completeEmergencyBackup,
    getTaskStatus
};
