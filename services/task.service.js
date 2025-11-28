const configService = require('./config.service');

const loadConfigSnapshot = () => configService.loadConfig();

const findTaskIndex = (tasks, taskId) => tasks.findIndex(task => task.id === taskId);

const ensureTaskExists = (task, taskId) => {
    if (!task) {
        throw new Error(`ID为 ${taskId} 的备份任务不存在。`);
    }
};

const withTaskUpdate = (taskId, patchProducer) => {
    const config = loadConfigSnapshot();
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
    configService.saveConfig(config);

    return updatedTask;
};

const getTaskMeta = (taskId) => {
    const config = loadConfigSnapshot();
    const task = config.tasks.find(item => item.id === taskId);
    ensureTaskExists(task, taskId);
    return task;
};

const getTaskConfigPayload = (taskId) => {
    const config = loadConfigSnapshot();
    const task = config.tasks.find(item => item.id === taskId);
    ensureTaskExists(task, taskId);

    return {
        task,
        huawei_obs: config.huawei_obs
    };
};

const setEmergencyStatus = (taskId, status, reason = null) => {
    const allowedStatuses = ['idle', 'pending', 'completed'];
    if (!allowedStatuses.includes(status)) {
        throw new Error(`无效的紧急备份状态: ${status}`);
    }

    return withTaskUpdate(taskId, () => ({
        emergency_backup: status,
        last_error: reason || null
    }));
};

const recordTaskFailure = (taskId, errorMessage) => {
    if (!errorMessage) {
        throw new Error('必须提供错误信息。');
    }

    return withTaskUpdate(taskId, () => ({
        last_error: errorMessage
    }));
};

const completeEmergencyBackup = (taskId) => withTaskUpdate(taskId, () => ({
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
