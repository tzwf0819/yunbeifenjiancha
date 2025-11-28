const express = require('express');
const router = express.Router();
const apiController = require('../controllers/api.controller');
const { webAuth } = require('../middleware/auth.middleware');

// --- 系统级 API ---
router.get('/config', webAuth, apiController.getConfig); // 获取配置
router.post('/config', webAuth, apiController.saveConfig); // 保存配置
router.get('/status', apiController.getSystemStatus); // 获取最新巡检状态
router.post('/run-check', webAuth, apiController.runManualCheck); // 手动触发巡检

// --- 任务级 API (给Python客户端和前端用) ---
router.get('/tasks/:id/config', apiController.getTaskConfig); // 获取任务配置
router.get('/tasks/:id/status', apiController.getTaskStatus); // 获取单个任务状态
router.post('/tasks/:id/status', apiController.updateTaskStatus); // 更新单个任务状态
router.post('/tasks/:id/report-failure', apiController.reportTaskFailure); // Python上报失败
router.post('/tasks/:id/complete-emergency-backup', apiController.completeEmergencyBackup); // Python通知紧急备份完成
router.get('/tasks/:id/files', webAuth, apiController.getTaskFiles); // 获取OBS文件列表

module.exports = router;
