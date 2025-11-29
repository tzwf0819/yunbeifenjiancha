const axios = require('axios');
const { loadConfig } = require('./config.service');

let cachedToken = null;
let tokenExpireAt = 0;

const formatTimestamp = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

/**
 * 获取企业微信的access_token
 */
const getWechatToken = async () => {
    const now = Date.now();
    if (cachedToken && now < tokenExpireAt) {
        return cachedToken;
    }

    const config = await loadConfig(); // [已重构] 异步加载配置
    const { corp_id, secret } = config.wechat_app;

    if (!corp_id || !secret) {
        throw new Error('企业微信配置不完整 (CorpID 或 Secret 缺失)。');
    }

    console.log('[企业微信服务] 准备获取 Token，将使用以下参数:');
    console.log(`- CorpID: ${corp_id}`);
    console.log(`- Secret: ******** (为安全起见，不打印完整secret)`);

    try {
        const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corp_id}&corpsecret=${secret}`;
        console.log(`[企业微信服务] 正在请求 URL: ${url.replace(secret, '********')}`);
        
        const response = await axios.get(url);
        
        if (response.data?.access_token) {
            console.log('[企业微信服务] 成功获取 Token。');
            cachedToken = response.data.access_token;
            const expiresIn = Number(response.data.expires_in) || 7200;
            tokenExpireAt = Date.now() + Math.max(expiresIn - 60, 60) * 1000;
            return cachedToken;
        }

        const errorInfo = response.data || { errmsg: '未知错误', errcode: 'N/A' };
        const errorMessage = `获取企业微信token失败: ${errorInfo.errmsg}, hint: [${errorInfo.hint || 'no hint'}], from ip: ${errorInfo.from_ip || 'no ip'}, more info at https://open.work.weixin.qq.com/devtool/query?e=${errorInfo.errcode} (错误码: ${errorInfo.errcode})`;
        throw new Error(errorMessage);

    } catch (error) {
        cachedToken = null;
        tokenExpireAt = 0;
        if (error.response) {
             console.error('[企业微信服务错误] API响应错误:', error.response.data);
             throw new Error(`企业微信API响应错误: ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
            console.error('[企业微信服务错误] 无响应:', error.request);
            throw new Error('请求企业微信API时未收到响应。');
        } else {
             console.error('[企业微信服务错误] 获取token时发生错误:', error.message);
             throw error;
        }
    }
};

/**
 * 发送企业微信文本消息
 */
const sendWechatMessage = async (token, content) => {
    const config = await loadConfig(); // [已重构] 异步加载配置
    const { agent_id, touser } = config.wechat_app;

    if (!agent_id || !touser) {
        console.warn('[企业微信服务警告] AgentID或ToUser未配置，跳过发送。');
        return;
    }
    
    console.log(`[企业微信服务] 准备发送消息给: ${touser}`);

    try {
        const response = await axios.post(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
            touser: touser,
            msgtype: "text",
            agentid: agent_id,
            text: { content: content },
        });

        // [新增诊断] 检查企业微信API的返回结果
        if (response.data && response.data.errcode === 0) {
            console.log('[企业微信服务] 消息API返回成功 (errcode: 0)。');
            // [新增诊断] 在日志中明确打印出用于发送的参数，方便用户核对
            console.log(`[企业微信服务诊断] 本次发送使用的参数 -> AgentID: ${agent_id}, ToUser: ${touser}`);
        } else {
            // 如果API返回了错误码，则将其作为错误抛出
            const errorInfo = response.data || { errmsg: '未知错误', errcode: 'N/A' };
            const errorMessage = `发送企业微信消息失败: ${errorInfo.errmsg} (错误码: ${errorInfo.errcode})`;
            console.error(`[企业微信服务错误] ${errorMessage}`);
            throw new Error(errorMessage);
        }

    } catch (error) {
        if (error.response) {
            console.error('[企业微信服务错误] 发送消息时API响应错误:', error.response.data);
            throw new Error(`企业微信API响应错误: ${JSON.stringify(error.response.data)}`);
        }
        console.error('[企业微信服务错误] 发送消息时发生底层错误:', error.message);
        throw error;
    }
};

const buildAbnormalLine = (item, index) => {
    const taskLabel = item.task_name || item.task_id || '未知任务';
    const dbLabel = item.db_name ? `/${item.db_name}` : '';
    const reason = item.reason || '未提供原因';
    const latestTime = item.latest_time || '未知时间';
    return `${index + 1}. ${taskLabel}${dbLabel} -> ${reason} (最新: ${latestTime})`;
};

const sendAbnormalNotification = async (reviewResults = [], options = {}) => {
    const abnormalItems = (reviewResults || []).filter(item => item && item.status && item.status !== '正常');

    if (abnormalItems.length === 0) {
        console.log('[企业微信服务] 未检测到异常项，跳过异常通知。');
        return;
    }

    const title = options.title || 'OBS备份巡检异常';
    const intro = options.intro || '巡检过程中发现以下异常，请及时排查：';
    const lines = abnormalItems.slice(0, 8).map((item, index) => buildAbnormalLine(item, index));

    if (abnormalItems.length > 8) {
        lines.push(`... 其余 ${abnormalItems.length - 8} 条异常已省略`);
    }

    if (Array.isArray(options.paymentWarnings) && options.paymentWarnings.length > 0) {
        lines.push('—— 缴费异常 ——');
        options.paymentWarnings.slice(0, 5).forEach((warning, index) => {
            lines.push(`P${index + 1}. ${warning}`);
        });
        if (options.paymentWarnings.length > 5) {
            lines.push(`... 其余 ${options.paymentWarnings.length - 5} 条缴费异常已省略`);
        }
    }

    const message = `【${title}】\n时间：${formatTimestamp()}\n异常合计：${abnormalItems.length}\n${intro}\n\n${lines.join('\n')}`;
    const token = await getWechatToken();
    await sendWechatMessage(token, message);
};

const sendNormalNotification = async (message = '巡检完成，一切正常。') => {
    const token = await getWechatToken();
    const payload = `【OBS备份巡检通知】\n时间：${formatTimestamp()}\n${message}`;
    await sendWechatMessage(token, payload);
};

    const payload = `【OBS备份巡检通知】\n时间：${formatTimestamp()}\n${message}`;
    await sendWechatMessage(token, payload);
};

// [新功能] 发送一条自定义的好消息 (纯文本格式)
const sendGoodNews = async (message) => {
    const token = await getWechatToken();
    const payload = `【每日份的好消息】\n${message}`;
    await sendWechatMessage(token, payload);
};

module.exports = { getWechatToken, sendWechatMessage, sendAbnormalNotification, sendNormalNotification, sendGoodNews };
