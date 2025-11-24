
const ObsClient = require('esdk-obs-nodejs');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// --- Config Management ---
const loadConfig = () => {
    if (!fs.existsSync(CONFIG_PATH)) return { buckets: [] };
    const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
    return fileContent ? JSON.parse(fileContent) : { buckets: [] };
};

const saveConfig = (config) => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
};

// --- Core Business Logic ---
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

const parseTimeFromFilename = (filename) => {
    const regex1 = /_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.bak$/;
    const regex2 = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})\.bak$/;
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

const applyRetentionPolicy = async (obsClient, bucketName, files, item) => {
    if (item.retain_latest_3 && files.length > 3) {
        const filesToDelete = files.slice(3).map(f => ({ Key: f.name }));
        if (filesToDelete.length > 0) {
            try {
                await obsClient.deleteObjects({ Bucket: bucketName, Objects: filesToDelete });
                console.log(`[Retention] Deleted ${filesToDelete.length} old files for prefix '${item.prefix}' in bucket '${bucketName}'.`);
            } catch (deleteError) {
                console.error(`[Retention] Failed to delete files for prefix '${item.prefix}':`, deleteError);
            }
        }
    }
};

const checkBackupItem = async (obsClient, bucketName, item) => {
    const { prefix, schedule } = item;
    const [frequency, count] = schedule.split('_');
    const now = new Date();

    try {
        const result = await obsClient.listObjects({ Bucket: bucketName, Prefix: prefix });
        if (result.CommonMsg.Status >= 300) throw new Error(`OBS API Error: ${result.CommonMsg.Code}`);

        const files = result.InterfaceResult.Contents.map(f => ({
            name: f.Key,
            time: parseTimeFromFilename(f.Key) || new Date(f.LastModified),
            size: f.Size,
        })).sort((a, b) => b.time - a.time);

        await applyRetentionPolicy(obsClient, bucketName, files, item);

        if (files.length === 0) {
            return { status: '异常', reason: '桶内无此备份文件', latest_file_name: 'N/A', latest_time: 'N/A' };
        }

        const latestFile = files[0];
        const timeDiffHours = (now - latestFile.time) / (1000 * 60 * 60);
        const expectedIntervalHours = frequency === 'hourly' ? 1.5 : (24 / count) + 2;

        if (timeDiffHours > expectedIntervalHours) {
            return { status: '异常', reason: `超过 ${Math.round(expectedIntervalHours)} 小时未备份`, latest_file_name: latestFile.name, latest_time: latestFile.time.toLocaleString() };
        }

        return { status: '正常', reason: '备份在预期时间内', latest_file_name: latestFile.name, latest_time: latestFile.time.toLocaleString() };

    } catch (error) {
        return { status: '异常', reason: `检查失败: ${error.message}`, latest_file_name: 'N/A', latest_time: 'N/A' };
    }
};

const getAllFiles = async (obsClient, bucketName) => {
    try {
        const result = await obsClient.listObjects({ Bucket: bucketName });
        if (result.CommonMsg.Status >= 300) return [];
        return result.InterfaceResult.Contents
            .map(f => ({ name: f.Key, time: new Date(f.LastModified).toLocaleString(), size: `${(f.Size / 1024 / 1024).toFixed(2)} MB` }))
            .sort((a, b) => new Date(b.time) - new Date(a.time));
    } catch (error) {
        console.error(`Failed to list files for bucket ${bucketName}:`, error);
        return [];
    }
};

const getBucketStatus = async () => {
    const config = loadConfig();
    const obsClient = getObsClient();
    const review_results = [];
    const all_bucket_files = [];

    if (!config.buckets) return { review_results: [], expired_buckets: [], all_bucket_files: [], last_updated: new Date().toLocaleString() };

    for (const bucket of config.buckets) {
        for (const item of bucket.items) {
            const result = await checkBackupItem(obsClient, bucket.name, item);
            review_results.push({ 
                bucket_name: bucket.name, 
                item_prefix: item.prefix, 
                payment_due_date: bucket.payment_due_date || '未设置',
                ...result 
            });
        }
        const files = await getAllFiles(obsClient, bucket.name);
        all_bucket_files.push({ bucket_name: bucket.name, files });
    }

    const expired_buckets = checkPaymentDates(config.buckets);
    return { review_results, expired_buckets, all_bucket_files, last_updated: new Date().toLocaleString() };
};

const checkPaymentDates = (buckets = []) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return buckets
        .filter(b => !!b.payment_due_date)
        .map(b => {
            const paymentDate = new Date(b.payment_due_date);
            const expiryDate = new Date(paymentDate.getFullYear() + 1, paymentDate.getMonth(), paymentDate.getDate());
            return {
                name: b.name,
                payment_date: b.payment_due_date,
                expiry_date: expiryDate.toISOString().split('T')[0]
            };
        });
};


// --- WeChat Notification ---
const getWechatToken = async (corpId, secret) => {
    const response = await axios.get(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`);
    if (response.data?.access_token) return response.data.access_token;
    throw new Error(`获取企业微信token失败: ${response.data.errmsg}`);
};

const sendWechatMessage = async (token, content, agentId, touser) => {
    await axios.post(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
        touser, msgtype: "text", agentid: agentId, text: { content },
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

    let textContent = `OBS每日巡检报告 - ${new Date().toLocaleDateString()}\n`;
    if (hasAbnormal) {
        textContent += '\n【异常备份项】:\n';
        review_results.filter(r => r.status === '异常').forEach(r => {
            textContent += `- ${r.bucket_name} / ${r.item_prefix}: ${r.status} (${r.reason})\n`;
        });
    }
    if (hasExpired) {
        textContent += '\n【续费提醒】:\n';
        expired_buckets.forEach(b => {
            textContent += `- 存储桶 ${b.name} 的服务将于 ${b.date} 到期！\n`;
        });
    }

    const token = await getWechatToken(config.wechat_app.corp_id, config.wechat_app.secret);
    await sendWechatMessage(token, textContent, config.wechat_app.agent_id, config.wechat_app.touser);
    console.log("已发送包含异常/到期信息的企业微信通知。");
};

module.exports = { loadConfig, saveConfig, getBucketStatus, runScheduledReport };
