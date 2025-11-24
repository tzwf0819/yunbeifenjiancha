const {
    getBucketStatus,
    formatSummaryReportContent,
    loadConfig,
    getAccessToken,
    sendWechatAppMessage
} = require('../shared/core-logic');

exports.main = async (event, context) => {
    console.log('定时报告任务开始执行...');

    // 加载配置
    const config = loadConfig();
    const wechatConfig = config.wechat_app;

    if (!wechatConfig) {
        console.error('企业微信配置 (wechat_app) 不存在，任务终止');
        return { code: -1, message: 'Wechat config not found' };
    }

    // 1. 获取存储桶状态数据
    const { review_results, bucket_files, expired_buckets } = await getBucketStatus();

    if (!review_results) {
        console.error('获取存储桶状态失败，任务终止');
        return { code: -1, message: 'Failed to get bucket status' };
    }

    // 2. 获取企业微信 Access Token
    const accessToken = await getAccessToken(wechatConfig.corp_id, wechatConfig.secret);
    if (!accessToken) {
        console.error('获取 Access Token 失败，任务终止');
        return { code: -1, message: 'Failed to get access token' };
    }

    // 3. 发送每个存储桶的文件列表
    console.log('开始发送文件列表报告...');
    for (const bucket of bucket_files) {
        const bucketContent = [
            `# 存储桶文件列表: ${bucket.bucket_name}`,
            `**报告生成时间**: ${new Date().toLocaleString()}`,
            '',
            ...bucket.files
        ].join('\n');
        
        await sendWechatAppMessage(accessToken, wechatConfig.agent_id, bucketContent, wechatConfig);
        // 增加短暂延时，避免触发企业微信的频率限制
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 4. 格式化并发送汇总报告
    console.log('开始发送汇总报告...');
    const summaryContent = formatSummaryReportContent({ review_results, expired_buckets });
    await sendWechatAppMessage(accessToken, wechatConfig.agent_id, summaryContent, wechatConfig);

    console.log('定时报告任务执行成功！');
    return { code: 0, message: 'OK' };
};