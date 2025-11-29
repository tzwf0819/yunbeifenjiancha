const configService = require('./config.service');

const configService = require('./config.service');

const findTaskIndex = (tasks, taskId) => tasks.findIndex(task => task.id === taskId);

const ensureTaskExists = (task, taskId) => {
    if (!task) {
        throw new Error(`ID为 ${taskId} 的备份任务不存在。`);
    }
};

// [已重构] 异步的、核心的更新函数
const withTaskUpdate = async (taskId, patchProducer) => {
    const config = await configService.loadConfig();
    const taskIndex = findTaskIndex(config.tasks, taskId);

    if (taskIndex === -1) {
        throw new Error(`ID为 ${taskId} 的备份任务不存在。`);
    }

    const currentTask = config.tasks[taskIndex];
    const patch = typeof patchProducer === 'function' ? patchProducer(currentTask) : {};
    const updatedTask = {
        ...currentTask,
        ...patch,
        last_status_update: new Date().toISOString()
    };

    if (!updatedTask.emergency_backup) {
        updatedTask.emergency_backup = 'idle';
    }

    config.tasks[taskIndex] = updatedTask;
    await configService.saveConfig(config);

    return updatedTask;
};

// [已重构] 异步获取任务元数据
const getTaskMeta = async (taskId) => {
    const config = await configService.loadConfig();
    const task = config.tasks.find(item => item.id === taskId);
    ensureTaskExists(task, taskId);
    return task;
};

// [已重构] 异步获取任务完整配置
const getTaskConfigPayload = async (taskId) => {
    const config = await configService.loadConfig();
    const task = config.tasks.find(item => item.id === taskId);
    ensureTaskExists(task, taskId);

    return {
        task,
        huawei_obs: config.huawei_obs
    };
};

// [已重构] 异步设置紧急备份状态
const setEmergencyStatus = async (taskId, status, reason = null) => {
    const allowedStatuses = ['idle', 'pending', 'completed'];
    if (!allowedStatuses.includes(status)) {
        throw new Error(`无效的紧急备份状态: ${status}`);
    }

    return withTaskUpdate(taskId, () => ({
        emergency_backup: status,
        last_error: reason || null
    }));
};

// [已重构] 异步记录任务失败
const recordTaskFailure = async (taskId, errorMessage) => {
    if (!errorMessage) {
        throw new Error('必须提供错误信息。');
    }

    return withTaskUpdate(taskId, () => ({
        last_error: errorMessage
    }));
};

// [已重构] 异步完成紧急备份
const completeEmergencyBackup = async (taskId) => withTaskUpdate(taskId, () => ({
    emergency_backup: 'completed',
    last_error: null
}));

module.exports = {
    getTaskMeta,
    getTaskConfigPayload,
    setEmergencyStatus,
    recordTaskFailure,
    completeEmergencyBackup
};
