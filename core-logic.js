
const ObsClient = require('esdk-obs-nodejs');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// --- 配置管理 ---
const loadConfig = () => {
    if (!fs.existsSync(CONFIG_PATH)) {
        return { buckets: [] };
    }
    const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
    return fileContent ? JSON.parse(fileContent) : { buckets: [] };
};

const saveConfig = (config) => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
};

// --- 核心业务逻辑 ---
const getObsClient = () => {
    const config = loadConfig();
    if (!config.huawei_obs || !config.huawei_obs.ak || !config.huawei_obs.sk || !config.huawei_obs.endpoint) {
        throw new Error('OBS配置不完整，请先在管理后台配置！');
    }
    return new ObsClient({
        access_key_id: config.huawei_obs.ak,
        secret_access_key: config.huawei_obs.sk,
        server: config.huawei_obs.endpoint,
    });
};

const checkBucket = async (obsClient, bucketName) => {
    try {
        const result = await obsClient.listObjects({ Bucket: bucketName, MaxKeys: 1 });
        if (result.CommonMsg.Status < 300 && result.InterfaceResult.Contents.length > 0) {
            const latestFile = result.InterfaceResult.Contents[0];
            return {
                status: '正常',
                reason: '获取到最新文件',
                latest_time: latestFile.LastModified,
                latest_file_name: latestFile.Key
            };
        } else {
            return { status: '异常', reason: '桶内无文件', latest_time: 'N/A', latest_file_name: 'N/A' };
        }
    } catch (error) {
        console.error(`检查桶 ${bucketName} 失败:`, error);
        return { status: '异常', reason: `检查失败: ${error.message}`, latest_time: 'N/A', latest_file_name: 'N/A' };
    }
};

const getBucketStatus = async () => {
    const config = loadConfig();
    const obsClient = getObsClient();
    const review_results = [];

    if (!config.buckets || config.buckets.length === 0) {
        return { review_results: [], expired_buckets: [], last_updated: new Date().toLocaleString() };
    }

    for (const bucket of config.buckets) {
        const result = await checkBucket(obsClient, bucket.name);
        review_results.push({ bucket_name: bucket.name, ...result });
    }

    const expired_buckets = checkPaymentDates(config.buckets);

    return {
        review_results,
        expired_buckets,
        last_updated: new Date().toLocaleString()
    };
};

const checkPaymentDates = (buckets) => {
    const today = new Date();
    const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    const expired = [];

    for (const bucket of buckets) {
        if (bucket.payment_due_date) {
            const dueDate = new Date(bucket.payment_due_date);
            if (dueDate <= oneYearAgo) {
                expired.push(bucket.name);
            }
        }
    }
    return expired;
};

// --- 企业微信通知 ---
const getWechatToken = async (corpId, secret) => {
    const response = await axios.get(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`);
    if (response.data && response.data.access_token) {
        return response.data.access_token;
    } else {
        throw new Error(`获取企业微信token失败: ${response.data.errmsg}`);
    }
};

const sendWechatMessage = async (token, content, agentId, touser) => {
    await axios.post(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
        touser: touser,
        msgtype: "markdown",
        agentid: agentId,
        markdown: { content },
    });
};

// --- 定时/手动报告任务 ---
const runScheduledReport = async () => {
    const config = loadConfig();
    if (!config.wechat_app || !config.wechat_app.corp_id || !config.wechat_app.secret) {
        console.log("企业微信配置不完整，跳过发送报告。");
        return; // 静默处理，不报错
    }

    const { review_results, expired_buckets } = await getBucketStatus();

    const hasAbnormal = review_results.some(r => r.status === '异常');
    const hasExpired = expired_buckets.length > 0;

    // "无事不打扰" 逻辑：只在有异常或有到期时才发送通知
    if (!hasAbnormal && !hasExpired) {
        console.log("所有桶均正常，且无到期提醒。本次不发送企业微信通知。");
        return;
    }

    let markdownContent = `**OBS每日巡检报告 - ${new Date().toLocaleDateString()}**\n\n`;
    
    if (hasAbnormal) {
        markdownContent += '> **<font color="warning">异常结果</font>**:\n';
        review_results.filter(r => r.status === '异常').forEach(r => {
            markdownContent += `> - **${r.bucket_name}**: <font color="warning">${r.status}</font> (${r.reason})\n`;
        });
    }
    
    if(hasAbnormal && !hasExpired) {
        markdownContent += '\n> **其他桶状态**: <font color="info">正常</font>\n';
    }

    if (hasExpired) {
        markdownContent += '\n> **<font color="warning">续费提醒</font>**:\n';
        expired_buckets.forEach(b => {
            markdownContent += `> - 存储桶 **${b}** 的包年服务即将到期，请提醒客户续费！\n`;
        });
    }

    const token = await getWechatToken(config.wechat_app.corp_id, config.wechat_app.secret);
    await sendWechatMessage(token, markdownContent, config.wechat_app.agent_id, config.wechat_app.touser);
    console.log("已发送包含异常/到期信息的企业微信通知。");
};

module.exports = { loadConfig, saveConfig, getBucketStatus, runScheduledReport };
