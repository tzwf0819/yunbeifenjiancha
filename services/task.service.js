const configService = require('./config.service');

// [核心修复] 所有的函数都必须是异步的，因为它们都依赖于异步的 loadConfig

const getTaskMeta = async (taskId) => {
    const config = await configService.loadConfig();
    const task = (config.tasks || []).find(t => t.id === taskId);
    if (!task) {
        throw new Error(`任务ID ${taskId} 不存在于配置中。`);
    }
    return {
        emergency_backup: task.emergency_backup || 'idle',
        last_error: task.last_error || null,
        requires_payment: Boolean(task.requires_payment),
        payment_due_date: task.payment_due_date || null,
        last_status_update: task.last_status_update || null
    };
};

const setEmergencyStatus = async (taskId, status, reason) => {
    const config = await configService.loadConfig();
    const taskIndex = (config.tasks || []).findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
        throw new Error(`任务ID ${taskId} 不存在于配置中，无法更新紧急状态。`);
    }

    const task = config.tasks[taskIndex];
    task.emergency_backup = status;
    task.last_status_update = new Date().toISOString();
    
    // 当状态被设为pending时，清除旧错误。当提供了reason时，记录新错误。
    if (status === 'pending') {
        task.last_error = null;
    }
    if (reason) {
        task.last_error = reason;
    }

    // saveConfig是异步的，但我们在这里无需等待它完成
    configService.saveConfig(config);
    return task;
};

const recordTaskFailure = async (taskId, errorMessage) => {
    return await setEmergencyStatus(taskId, 'failed', errorMessage);
};

const completeEmergencyBackup = async (taskId) => {
    return await setEmergencyStatus(taskId, 'completed');
};

const getTaskConfigPayload = async (taskId) => {
    const config = await configService.loadConfig();
    const task = (config.tasks || []).find(t => t.id === taskId);
    if (!task) {
        throw new Error(`任务ID ${taskId} 不存在于配置中，无法获取其完整配置。`);
    }
    return {
        huawei_obs: config.huawei_obs,
        task: task
    };
};

module.exports = {
    getTaskMeta,
    setEmergencyStatus,
    recordTaskFailure,
    completeEmergencyBackup,
    getTaskConfigPayload
};
