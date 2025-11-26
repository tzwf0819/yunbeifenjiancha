const ObsClient = require('esdk-obs-nodejs');
const { loadConfig } = require('./config.service');

/**
 * 创建并返回一个配置好的OBS客户端实例
 * @returns {ObsClient}
 */
const getObsClient = () => {
    const config = loadConfig();
    const { ak, sk, endpoint } = config.huawei_obs;

    if (!ak || !sk || !endpoint) {
        throw new Error('OBS配置不完整 (AK, SK, 或 Endpoint 缺失)，请在管理后台配置！');
    }

    return new ObsClient({
        access_key_id: ak,
        secret_access_key: sk,
        server: endpoint,
    });
};

/**
 * 从文件名中解析日期时间
 * @param {string} filename - 文件名
 * @returns {Date|null}
 */
const parseTimeFromFilename = (filename) => {
    const regex = /_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.bak$/;
    const match = filename.match(regex);
    if (match) {
        const [, year, month, day, hour, minute, second] = match;
        return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`); // 假设为UTC时间
    }
    return null;
};


/**
 * 检查单个数据库的备份状态
 * @param {ObsClient} obsClient - OBS客户端实例
 * @param {string} bucketName - 存储桶名称
 * @param {object} task - 任务对象
 * @param {object} db - 数据库对象
 * @returns {Promise<object>} 检查结果
 */
const checkDatabaseBackup = async (obsClient, bucketName, task, db) => {
    const { folder } = task;
    const { prefix, times } = db;
    const fullPrefix = `${folder}/${prefix}`;

    try {
        const result = await obsClient.listObjects({ Bucket: bucketName, Prefix: fullPrefix });

        if (result.CommonMsg.Status >= 300) {
            // 提供最详细的错误信息
            const errorDetail = `Code: ${result.CommonMsg.Code}, Message: ${result.CommonMsg.Message}, RequestId: ${result.CommonMsg.RequestId}`;
            throw new Error(`OBS API请求失败: ${errorDetail}`);
        }

        const files = result.InterfaceResult.Contents
            .filter(f => f.Key.endsWith('.bak'))
            .map(f => ({
                name: f.Key,
                time: parseTimeFromFilename(f.Key) || new Date(f.LastModified),
                size: f.Size,
            }))
            .sort((a, b) => b.time - a.time);

        if (files.length === 0) {
            return { status: '异常', reason: '无备份文件', latest_file_name: 'N/A', latest_time: 'N/A' };
        }

        const latestFile = files[0];
        const schedule_parts = times.split(',').filter(t => t.trim() !== '');
        const count = schedule_parts.length > 0 ? schedule_parts.length : 1;
        const expectedIntervalHours = (24 / count) + 4; // 增加4小时的容错缓冲
        const timeDiffHours = (new Date() - latestFile.time) / (1000 * 60 * 60);

        if (timeDiffHours > expectedIntervalHours) {
            return {
                status: '异常',
                reason: `超过 ${Math.round(expectedIntervalHours)} 小时未备份`,
                latest_file_name: require('path').basename(latestFile.name),
                latest_time: latestFile.time.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
            };
        }

        return {
            status: '正常',
            reason: '备份在预期时间内',
            latest_file_name: require('path').basename(latestFile.name),
            latest_time: latestFile.time.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        };

    } catch (error) {
        console.error(`[OBS服务错误] 检查存储桶 '${bucketName}' 的前缀 '${fullPrefix}' 时失败:`, error);
        // 将原始错误信息传递出去，以便上层可以捕获
        throw new Error(`检查OBS时发生底层错误: ${error.message}`);
    }
};

module.exports = { getObsClient, checkDatabaseBackup };
