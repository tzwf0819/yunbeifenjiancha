const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task.controller');
const { webAuth, serviceAuth } = require('../middleware/auth.middleware'); // 我们将把认证逻辑也移到中间件中

// --- Python备份客户端专用路由 ---

// 获取单个任务的完整配置
router.get('/:id/config', serviceAuth, taskController.getTaskConfigById);

// 报告紧急备份已完成
router.post('/:id/complete-emergency-backup', serviceAuth, taskController.completeEmergencyBackup);


// --- Web前端专用路由 ---

// 触发一个任务的紧急备份
router.post('/:id/trigger-emergency-backup', webAuth, taskController.triggerEmergencyBackup);

// 获取一个任务的实时状态（用于前端轮询）
router.get('/:id/status', webAuth, taskController.getTaskStatus);


module.exports = router;
