const configService = require('../services/config.service');
const statusService = require('../services/status.service');
const obsService = require('../services/obs.service');
const wechatService = require('../services/wechat.service');
const taskService = require('../services/task.service');

// 获取完整配置
exports.getConfig = (req, res) => {
    res.json(configService.loadConfig());
};

// 保存完整配置
exports.saveConfig = (req, res) => {
    try {
        configService.saveConfig(req.body);
        res.json({ success: true, message: '配置保存成功！' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 获取单个任务所需的完整配置（供Python客户端使用）
exports.getTaskConfig = (req, res) => {
    try {
        const payload = taskService.getTaskConfigPayload(req.params.id);
        res.json(payload);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

// 获取最新巡检状态 (给Dashboard用)
exports.getSystemStatus = (req, res) => {
    res.json(statusService.loadStatus());
};

// 手动触发一次完整的巡检
exports.runManualCheck = async (req, res) => {
    console.log(`[API控制器] 收到手动触发巡检任务的请求...`);
    try {
        const newStatus = await statusService.runCheckAndSave();
        const hasErrors = newStatus.review_results.some(r => r.status === '异常');
        const hasPaymentWarnings = (newStatus.payment_warnings || []).length > 0;
        if (hasErrors || hasPaymentWarnings) {
            await wechatService.sendAbnormalNotification(newStatus.review_results, { paymentWarnings: newStatus.payment_warnings });
        } else {
            await wechatService.sendNormalNotification('手动巡检完成，一切正常。');
        }
        res.json({ success: true, message: '巡检已完成，并已发送通知！' });
    } catch (error) {
        console.error('[API控制器] 手动巡检失败:', error);
        res.status(500).json({ success: false, message: `巡检失败: ${error.message}` });
    }
};

// 获取单个任务的最新状态 (给Python客户端用)
exports.getTaskStatus = (req, res) => {
    const { id } = req.params;
    const statusData = statusService.loadStatus();
    const taskResult = statusData.review_results.find(r => r.task_id === id);

    try {
        const taskMeta = taskService.getTaskMeta(id);
        return res.json({
            ...(taskResult || { status: 'not_found', task_id: id }),
            emergency_backup: taskMeta.emergency_backup || 'idle',
            last_error: taskMeta.last_error || null,
            requires_payment: Boolean(taskMeta.requires_payment),
            payment_due_date: taskMeta.payment_due_date || null,
            last_status_update: taskMeta.last_status_update || null
        });
    } catch (error) {
        if (taskResult) {
            return res.json({
                ...taskResult,
                emergency_backup: 'idle',
                last_error: null,
                requires_payment: false,
                payment_due_date: null,
                last_status_update: null
            });
        }
        return res.status(404).json({ status: 'not_found', message: error.message });
    }
};

// 更新单个任务的状态 (供前端触发紧急备份，或Python客户端回写状态)
exports.updateTaskStatus = (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body || {};

    if (!status) {
        return res.status(400).json({ success: false, message: '必须提供 status 字段。' });
    }

    try {
        const updatedTask = taskService.setEmergencyStatus(id, status, reason);
        statusService.runCheckAndSave().catch(err => console.error('异步巡检失败:', err));
        return res.json({
            success: true,
            task: {
                id: updatedTask.id,
                emergency_backup: updatedTask.emergency_backup,
                last_error: updatedTask.last_error,
                last_status_update: updatedTask.last_status_update
            }
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// 获取OBS文件列表
exports.getTaskFiles = async (req, res) => {
    const { id } = req.params;
    try {
        const config = configService.loadConfig();
        // [已修复] 将配置传递给 getObsClient
        const client = obsService.getObsClient(config.huawei_obs);
        const task = config.tasks.find(t => t.id === id);
        if (!task) {
            return res.status(404).json({ message: '任务未找到' });
        }
        const files = await obsService.listTaskFiles(client, config.huawei_obs.bucket_name, task.folder);
        res.json(files);
    } catch (error) {
        console.error(`[API控制器] 获取任务 ${id} 的文件列表失败:`, error);
        res.status(500).json({ message: error.message });
    }
};

// Python客户端上报失败信息
exports.reportTaskFailure = (req, res) => {
    const { id } = req.params;
    const { error: errorMessage } = req.body || {};

    if (!errorMessage) {
        return res.status(400).json({ success: false, message: '必须提供 error 字段。' });
    }

    try {
        const updatedTask = taskService.recordTaskFailure(id, errorMessage);
        res.json({
            success: true,
            task: {
                id: updatedTask.id,
                last_error: updatedTask.last_error,
                last_status_update: updatedTask.last_status_update
            }
        });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
};

// Python客户端在紧急备份完成后调用
exports.completeEmergencyBackup = (req, res) => {
    const { id } = req.params;
    try {
        const updatedTask = taskService.completeEmergencyBackup(id);
        res.json({
            success: true,
            task: {
                id: updatedTask.id,
                emergency_backup: updatedTask.emergency_backup,
                last_status_update: updatedTask.last_status_update
            }
        });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
};
