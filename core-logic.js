
const ObsClient = require('esdk-obs-nodejs');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// --- 配置管理 ---
const loadConfig = () => {
    if (!fs.existsSync(CONFIG_PATH)) return { buckets: [] };
    const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
    return fileContent ? JSON.parse(fileContent) : { buckets: [] };
};

const saveConfig = (config) => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
};

// --- 核心业务逻辑 ---
const getObsClient = () => {
    const config = loadConfig();
    if (!config.huawei_obs?.ak || !config.huawei_obs?.sk || !config.huawei_obs?.endpoint) {
        throw new Error('OBS配置不完整，请先在管理后台配置！');
    }
    return new ObsClient({
        access_key_id: config.huawei_obs.ak,
        secret_access_key: config.huawei_obs.sk,
        server: config.huawei_obs.endpoint,
    });
};

// 解析文件名中的时间
const parseTimeFromFilename = (filename) => {
    const regex1 = /_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.bak$/; // zhenyuan_20251123_074134.bak
    const regex2 = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})\.bak$/; // yuanchang2025-11-22_08-01.bak

    let match = filename.match(regex1);
    if (match) {
        const [, year, month, day, hour, minute, second] = match;
        return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    }

    match = filename.match(regex2);
    if (match) {
        const [, year, month, day, hour, minute] = match;
        return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
    }

    return null;
};

// 根据计划检查备份文件
const checkBackupItem = async (obsClient, bucketName, item) => {
    const { prefix, schedule } = item;
    const [frequency, count] = schedule.split('_');
    const now = new Date();
    let expectedBackups = [];

    // 计算期望的备份时间点
    if (frequency === 'hourly') {
        for (let i = 0; i < count; i++) {
            const checkTime = new Date(now);
            checkTime.setHours(now.getHours() - i);
            expectedBackups.push({ hour: checkTime.getHours() });
        }
    } else if (frequency === 'daily') {
        const interval = 24 / count;
        for (let i = 0; i < count; i++) {
            const checkTime = new Date(now);
            // This logic assumes backups are spread out; a simpler check is better.
        }
    }

    try {
        const result = await obsClient.listObjects({ Bucket: bucketName, Prefix: prefix });
        if (result.CommonMsg.Status >= 300) {
            throw new Error(`OBS API Error: ${result.CommonMsg.Code}`)
        }

        const files = result.InterfaceResult.Contents.map(f => ({
            name: f.Key,
            time: parseTimeFromFilename(f.Key) || new Date(f.LastModified),
        })).sort((a, b) => b.time - a.time);

        if (files.length === 0) {
            return { status: '异常', reason: '桶内无此备份文件', latest_file_name: 'N/A', latest_time: 'N/A' };
        }
        
        const latestFile = files[0];
        const timeDiffHours = (now - latestFile.time) / (1000 * 60 * 60);

        let expectedIntervalHours;
        if (frequency === 'hourly') expectedIntervalHours = 1.5; // Allow some delay
        if (frequency === 'daily') expectedIntervalHours = (24 / count) + 2; // Allow more delay for daily backups

        if (timeDiffHours > expectedIntervalHours) {
             return { status: '异常', reason: `超过 ${Math.round(expectedIntervalHours)} 小时未备份`, latest_file_name: latestFile.name, latest_time: latestFile.time.toLocaleString() };
        }

        return { status: '正常', reason: '备份在预期时间内', latest_file_name: latestFile.name, latest_time: latestFile.time.toLocaleString() };

    } catch (error) {
        return { status: '异常', reason: `检查失败: ${error.message}`, latest_file_name: 'N/A', latest_time: 'N/A' };
    }
};

const getBucketStatus = async () => {
    const config = loadConfig();
    const obsClient = getObsClient();
    const review_results = [];

    if (!config.buckets) return { review_results: [], expired_buckets: [], last_updated: new Date().toLocaleString() };

    for (const bucket of config.buckets) {
        for (const item of bucket.items) {
            const result = await checkBackupItem(obsClient, bucket.name, item);
            review_results.push({ 
                bucket_name: bucket.name, 
                item_prefix: item.prefix, 
                ...result 
            });
        }
    }

    const expired_buckets = checkPaymentDates(config.buckets);
    return { review_results, expired_buckets, last_updated: new Date().toLocaleString() };
};

const checkPaymentDates = (buckets = []) => {
    const today = new Date();
    const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    return buckets
        .filter(b => b.payment_due_date && new Date(b.payment_due_date) <= oneYearAgo)
        .map(b => b.name);
};


// --- 企业微信通知 ---
const getWechatToken = async (corpId, secret) => {
    const response = await axios.get(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`);
    if (response.data?.access_token) return response.data.access_token;
    throw new Error(`获取企业微信token失败: ${response.data.errmsg}`);
};

const sendWechatMessage = async (token, content, agentId, touser) => {
    await axios.post(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
        touser, msgtype: "markdown", agentid: agentId, markdown: { content },
    });
};

const runScheduledReport = async () => {
    const config = loadConfig();
    if (!config.wechat_app?.corp_id) {
        console.log("企业微信配置不完整，跳过发送报告。");
        return;
    }

    const { review_results, expired_buckets } = await getBucketStatus();
    const hasAbnormal = review_results.some(r => r.status === '异常');
    const hasExpired = expired_buckets.length > 0;

    if (!hasAbnormal && !hasExpired) {
        console.log("所有监控项均正常，不发送通知。");
        return;
    }

    let markdownContent = `**OBS每日巡检报告 - ${new Date().toLocaleDateString()}**\n`;
    if (hasAbnormal) {
        markdownContent += '\n> **<font color="warning">异常备份项</font>**:\n';
        review_results.filter(r => r.status === '异常').forEach(r => {
            markdownContent += `> - **${r.bucket_name} / ${r.item_prefix}**: <font color="warning">${r.status}</font> (${r.reason})\n`;
        });
    }
    if (hasExpired) {
        markdownContent += '\n> **<font color="warning">续费提醒</font>**:\n';
        expired_buckets.forEach(b => {
            markdownContent += `> - 存储桶 **${b}** 的包年服务即将到期！\n`;
        });
    }

    const token = await getWechatToken(config.wechat_app.corp_id, config.wechat_app.secret);
    await sendWechatMessage(token, markdownContent, config.wechat_app.agent_id, config.wechat_app.touser);
    console.log("已发送包含异常/到期信息的企业微信通知。");
};

module.exports = { loadConfig, saveConfig, getBucketStatus, runScheduledReport };
