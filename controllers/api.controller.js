const configService = require('../services/config.service');
const statusService = require('../services/status.service');
const obsService = require('../services/obs.service');
const wechatService = require('../services/wechat.service');
const taskService = require('../services/task.service');

exports.getConfig = async (req, res) => {
    try {
        const config = await configService.loadConfig();
        res.json(config);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.saveConfig = async (req, res) => {
    try {
        await configService.saveConfig(req.body);
        res.json({ success: true, message: '配置保存成功！' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getTaskConfig = async (req, res) => {
    try {
        const payload = await taskService.getTaskConfigPayload(req.params.id);
        res.json(payload);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

exports.getSystemStatus = (req, res) => {
    res.json(statusService.loadStatus());
};

exports.runManualCheck = async (req, res) => {
    console.log(`[API控制器] 收到手动触发巡检任务的请求...`);
    try {
        const newStatus = await statusService.runCheckAndSave();
        const hasErrors = (newStatus.review_results || []).some(r => r.status === '异常');
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

exports.getTaskStatus = async (req, res) => {
    const { id } = req.params;
    const statusData = statusService.loadStatus();
    const taskResult = (statusData.review_results || []).find(r => r.task_id === id);

    try {
        const taskMeta = await taskService.getTaskMeta(id);
        return res.json({
            ...(taskResult || { status: 'not_found', task_id: id }),
            ...taskMeta
        });
    } catch (error) {
        if (taskResult) {
            return res.json(taskResult);
        }
        return res.status(404).json({ status: 'not_found', message: error.message });
    }
};

exports.updateTaskStatus = async (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body || {};

    if (!status) {
        return res.status(400).json({ success: false, message: '必须提供 status 字段。' });
    }

    try {
        const updatedTask = await taskService.setEmergencyStatus(id, status, reason);
        // 触发一个异步的、无需等待的巡检来更新状态
        statusService.runCheckAndSave().catch(err => console.error('异步巡检失败:', err));
        return res.json({ success: true, task: updatedTask });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

exports.getTaskFiles = async (req, res) => {
    const { id } = req.params;
    try {
        const config = await configService.loadConfig();
        const client = obsService.getObsClient(config.huawei_obs);
        const task = (config.tasks || []).find(t => t.id === id);
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

exports.reportTaskFailure = async (req, res) => {
    const { id } = req.params;
    const { error: errorMessage } = req.body || {};

    if (!errorMessage) {
        return res.status(400).json({ success: false, message: '必须提供 error 字段。' });
    }

    try {
        const updatedTask = await taskService.recordTaskFailure(id, errorMessage);
        res.json({ success: true, task: updatedTask });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
};

exports.completeEmergencyBackup = async (req, res) => {
    const { id } = req.params;
    try {
        const updatedTask = await taskService.completeEmergencyBackup(id);
        res.json({ success: true, task: updatedTask });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
};
