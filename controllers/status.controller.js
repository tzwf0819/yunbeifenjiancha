const configService = require('../services/config.service');
const obsService = require('../services/obs.service');
const wechatService = require('../services/wechat.service');

/**
 * 执行所有备份任务的巡检
 * @returns {Promise<object>} 包含巡检结果和最后更新时间的对象
 */
const getFullStatus = async () => {
    const config = configService.loadConfig();
    const obsClient = obsService.getObsClient();
    const review_results = [];

    const bucketName = config.huawei_obs.bucket_name;
    if (!bucketName) {
        console.warn('OBS存储桶名称未配置，跳过巡检。');
        return { review_results: [], last_updated: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) };
    }

    for (const task of config.tasks) {
        for (const db of task.databases) {
            try {
                const result = await obsService.checkDatabaseBackup(obsClient, bucketName, task, db);
                review_results.push({
                    task_name: task.name,
                    db_name: db.name,
                    ...result
                });
            } catch (error) {
                // 从OBS服务捕获错误并格式化为结果
                review_results.push({
                    task_name: task.name,
                    db_name: db.name,
                    status: '异常',
                    reason: error.message, // 使用从服务层传递过来的详细错误信息
                    latest_file_name: 'N/A',
                    latest_time: 'N/A'
                });
            }
        }
    }

    return { review_results, last_updated: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) };
};

/**
 * 执行定时报告，检查异常并发送企业微信通知
 */
const runScheduledReport = async () => {
    console.log('开始执行每日巡检报告任务...');
    const { review_results } = await getFullStatus();
    const abnormalItems = review_results.filter(r => r.status === '异常');

    let textContent;
    if (abnormalItems.length === 0) {
        textContent = `[巡检报告] 所有备份任务均正常 (${new Date().toLocaleDateString('zh-CN')})。`;
        console.log('所有监控项均正常，准备发送正常通知。');
    } else {
        textContent = `[巡检报告] OBS备份每日巡检发现异常 - ${new Date().toLocaleDateString('zh-CN')}\n\n【异常备份项】:\n`;
        abnormalItems.forEach(r => {
            textContent += `- ${r.task_name} (${r.db_name}): ${r.reason}\n`;
        });
        console.log('发现异常备份项，准备发送企业微信通知。');
    }

    try {
        const token = await wechatService.getWechatToken();
        await wechatService.sendWechatMessage(token, textContent);
        console.log('企业微信通知已发送。');
    } catch (error) {
        console.error('执行定时报告失败（获取token或发送消息时出错）:', error.message);
    }
};

module.exports = { getFullStatus, runScheduledReport };
