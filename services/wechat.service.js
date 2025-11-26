const axios = require('axios');
const { loadConfig } = require('./config.service');

/**
 * 获取企业微信的access_token
 * @returns {Promise<string>} access_token
 */
const getWechatToken = async () => {
    const config = loadConfig();
    const { corp_id, secret } = config.wechat_app;

    if (!corp_id || !secret) {
        throw new Error('企业微信配置不完整 (CorpID 或 Secret 缺失)。');
    }

    try {
        const response = await axios.get(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corp_id}&corpsecret=${secret}`);
        if (response.data?.access_token) {
            return response.data.access_token;
        }
        // 如果API返回错误，则抛出详细信息
        throw new Error(`获取企业微信token失败: ${response.data.errmsg} (错误码: ${response.data.errcode})`);
    } catch (error) {
        console.error('[企业微信服务错误] 获取token时失败:', error.message);
        throw error; // 将错误继续向上抛出
    }
};

/**
 * 发送企业微信文本消息
 * @param {string} token - access_token
 * @param {string} content - 消息内容
 */
const sendWechatMessage = async (token, content) => {
    const config = loadConfig();
    const { agent_id, touser } = config.wechat_app;

    if (!agent_id || !touser) {
        console.warn('[企业微信服务警告] AgentID或ToUser未配置，跳过发送。');
        return;
    }

    try {
        await axios.post(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
            touser: touser,
            msgtype: "text",
            agentid: agent_id,
            text: { content: content },
        });
    } catch (error) {
        console.error('[企业微信服务错误] 发送消息时失败:', error.response?.data || error.message);
        // 发送失败不应中断主流程，因此只记录错误
    }
};

module.exports = { getWechatToken, sendWechatMessage };
