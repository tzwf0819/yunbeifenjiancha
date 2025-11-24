const ObsClient = require('esdk-obs-nodejs');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 从云函数配置中加载配置，这里用模拟的JSON，实际部署时应从云函数环境变量或tcb.json中读取
const tcb = require('tcb-admin-node');

async function loadConfig() {
    try {
        const app = tcb.init({ env: tcb.getCurrentEnv().envId });
        const db = app.database();
        const config = await db.collection('system_config').doc('default_config').get();
        return config.data[0] || {};
    } catch (error) {
        console.error('从云数据库加载配置失败', error);
        return {};
    }
}

async function getBucketStatus() {
    const config = loadConfig();
    const { access_key, secret_key, region, special_buckets, bucket_schedules, bucket_payment_dates } = config.obs_config;

    if (!special_buckets || special_buckets.length === 0) {
        console.warn('配置文件中没有指定special_buckets');
        return { review_results: [], bucket_files: [], expired_buckets: [] };
    }

    const obsClient = new ObsClient({
        access_key_id: access_key,
        secret_access_key: secret_key,
        server: `obs.${region}.myhuaweicloud.com`,
    });

    let review_results = [];
    let bucket_files = [];

    const { Buckets } = await obsClient.listBuckets();
    
    for (const bucket of Buckets) {
        if (!special_buckets.includes(bucket.Name)) {
            continue;
        }

        const bucketName = bucket.Name;
        let bucket_file_list = [];
        let all_objects = [];
        let nextMarker = null;

        // 循环获取所有对象
        while (true) {
            const result = await obsClient.listObjects({ Bucket: bucketName, Marker: nextMarker });
            all_objects.push(...result.Contents);
            if (result.IsTruncated) {
                nextMarker = result.NextMarker;
            } else {
                break;
            }
        }
        
        if (all_objects.length === 0) {
            bucket_file_list.push('该存储桶中没有文件');
        } else {
            const sortedObjects = all_objects.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
            const filesToShow = sortedObjects.slice(0, 10);

            filesToShow.forEach(obj => {
                bucket_file_list.push(`- ${obj.Key} (更新于: ${new Date(obj.LastModified).toLocaleString()})`);
            });

            if (sortedObjects.length > 10) {
                bucket_file_list.push(`... 还有 ${sortedObjects.length - 10} 个更早的文件未显示 ...`);
            }
        }

        bucket_files.push({ bucket_name: bucketName, files: bucket_file_list });
        
        if (bucket_schedules && bucket_schedules[bucketName]) {
            const result = reviewBucketFiles(bucketName, all_objects, bucket_schedules[bucketName]);
            review_results.push(result);
        }
    }

    const expired_buckets = checkPaymentDates(bucket_payment_dates || {});
    
    return { review_results, bucket_files, expired_buckets };
}

function reviewBucketFiles(bucketName, objects, schedule) {
    const { frequency, count } = schedule;
    if (objects.length === 0) {
        return { bucket_name: bucketName, status: '异常', reason: '存储桶中没有文件', expected_count: count, actual_count: 0, latest_time: null };
    }

    const sortedObjects = objects.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
    const latestTime = new Date(sortedObjects[0].LastModified);
    const now = new Date();

    if (frequency === 'daily') {
        const threshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const recentFiles = sortedObjects.filter(obj => new Date(obj.LastModified) >= threshold);
        const actualCount = recentFiles.length;

        if (actualCount >= count) {
            return { bucket_name: bucketName, status: '正常', reason: `过去24小时上传了 ${actualCount} 个文件`, expected_count: count, actual_count: actualCount, latest_time: latestTime.toLocaleString() };
        } else {
            return { bucket_name: bucketName, status: '异常', reason: `文件数量不足，预期 ${count} 个，实际 ${actualCount} 个`, expected_count: count, actual_count: actualCount, latest_time: latestTime.toLocaleString() };
        }
    }
    return { bucket_name: bucketName, status: '未知', reason: '未知的审查频率配置', expected_count: count, actual_count: objects.length, latest_time: latestTime.toLocaleString() };
}

function checkPaymentDates(bucketPaymentDates) {
    const expiredBuckets = [];
    const currentDate = new Date();
    for (const [bucketName, paymentDateStr] of Object.entries(bucketPaymentDates)) {
        const paymentDate = new Date(paymentDateStr);
        const daysDiff = (currentDate - paymentDate) / (1000 * 60 * 60 * 24);
        if (daysDiff > 365) {
            expiredBuckets.push({ name: bucketName, payment_date: paymentDateStr, days_overdue: Math.floor(daysDiff - 365) });
        }
    }
    return expiredBuckets;
}

async function getAccessToken(corpId, appSecret) {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${appSecret}`;
    try {
        const response = await axios.get(url);
        if (response.data.errcode === 0) {
            return response.data.access_token;
        }
        console.error(`获取access_token失败: ${response.data.errmsg}`);
        return null;
    } catch (error) {
        console.error(`获取access_token时发生错误: ${error.message}`);
        return null;
    }
}

async function sendWechatAppMessage(accessToken, agentId, content, { touser = '@all', toparty = '', totag = '' }) {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
    const payload = {
        touser, toparty, totag,
        msgtype: 'markdown',
        agentid: agentId,
        markdown: { content },
        safe: 0,
        enable_duplicate_check: 0,
        duplicate_check_interval: 1800,
    };
    try {
        const response = await axios.post(url, payload);
        if (response.data.errcode === 0) {
            console.log('企业微信应用消息发送成功');
        } else {
            console.error(`企业微信应用消息发送失败: ${response.data.errmsg}`);
        }
    } catch (error) {
        console.error(`发送企业微信应用消息时发生错误: ${error.message}`);
    }
}

function formatSummaryReportContent({ review_results, expired_buckets }) {
    if (!review_results) return "没有有效的审查结果。";
    
    const normalCount = review_results.filter(r => r.status === '正常').length;
    const abnormalCount = review_results.filter(r => r.status === '异常').length;

    let content = [
        `# 存储桶上传情况汇总报告`,
        `**报告生成时间**: ${new Date().toLocaleString()}`,
        `**审查的存储桶总数**: ${review_results.length}`,
        ``,
        `- **正常存储桶数量**: <font color='info'>${normalCount}</font>`,
        `- **异常存储桶数量**: <font color='warning'>${abnormalCount}</font>`,
        `- **缴费超期存储桶数量**: <font color='warning'>${expired_buckets.length}</font>`,
        ``
    ];

    if (abnormalCount > 0) {
        content.push("**<font color='warning'>异常存储桶列表:</font>**");
        review_results.forEach(r => {
            if (r.status === '异常') content.push(`- ${r.bucket_name}: ${r.reason}`);
        });
        content.push("");
    }

    if (expired_buckets.length > 0) {
        content.push("**<font color='warning'>缴费超期存储桶列表:</font>**");
        expired_buckets.forEach(bucket => {
            content.push(`- ${bucket.name}: 最后缴费日期 ${bucket.payment_date}, 超期 ${bucket.days_overdue} 天`);
        });
        content.push("");
    }
    
    return content.join('\n');
}

module.exports = {
    getBucketStatus,
    formatSummaryReportContent,
    loadConfig,
    getAccessToken,
    sendWechatAppMessage
};