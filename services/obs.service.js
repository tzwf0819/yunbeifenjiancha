const ObsClient = require('esdk-obs-nodejs');

let obsClientInstance;
const SCHEDULE_TOLERANCE_MINUTES = 45;
const HOURS_24_IN_MS = 24 * 60 * 60 * 1000;

const ensureContents = (data) => (Array.isArray(data?.Contents) ? data.Contents : []);

// 获取OBS客户端单例
const getObsClient = (config) => {
    if (!config) {
        throw new Error('[OBS服务] 未获取到任何OBS配置。');
    }

    const { ak, sk, endpoint, server, bucket_name } = config;
    const resolvedServer = server || endpoint;

    if (!ak || !sk || !resolvedServer || !bucket_name) {
        throw new Error('[OBS服务] OBS客户端配置不完整，无法初始化。');
    }

    if (!obsClientInstance) {
        obsClientInstance = new ObsClient({
            access_key_id: ak,
            secret_access_key: sk,
            server: resolvedServer
        });
    }

    return obsClientInstance;
};

// [已重构] 从文件名解析时间戳
const parseTimeFromFilename = (filename = '') => {
    const match = filename.match(/_(\d{8}_\d{6})_/);
    if (!match) return null;
    const timestamp = match[1];
    const [datePart, timePart] = timestamp.split('_');
    const year = datePart.substring(0, 4);
    const month = datePart.substring(4, 6);
    const day = datePart.substring(6, 8);
    const hour = timePart.substring(0, 2);
    const minute = timePart.substring(2, 4);
    const second = timePart.substring(4, 6);
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
};

const parseScheduleTimes = (times) => {
    if (!times) return [];
    return times.split(',').map(str => str.trim()).filter(Boolean);
};

const computeSlotDate = (timeStr, now) => {
    const [hour, minute] = timeStr.split(':').map(num => parseInt(num, 10));
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate > now) {
        candidate.setDate(candidate.getDate() - 1);
    }
    return candidate;
};

const buildExpectedSlots = (db, now) => {
    const scheduleTimes = parseScheduleTimes(db.times);
    if (scheduleTimes.length) {
        return scheduleTimes.map((timeStr) => {
            const expectedAt = computeSlotDate(timeStr, now);
            return expectedAt ? { label: timeStr, expectedAt } : null;
        }).filter(Boolean);
    }

    if (db.backup_frequency === '每小时一次') {
        const slots = [];
        for (let i = 0; i < 6; i += 1) {
            const slotDate = new Date(now.getTime() - i * 60 * 60 * 1000);
            const label = `${slotDate.getHours().toString().padStart(2, '0')}:${slotDate.getMinutes().toString().padStart(2, '0')}`;
            slots.push({ label, expectedAt: slotDate });
        }
        return slots;
    }

    return [{ label: '最近24小时', expectedAt: new Date(now.getTime() - HOURS_24_IN_MS) }];
};

const evaluateSlotCoverage = (slots, files) => {
    const toleranceMs = SCHEDULE_TOLERANCE_MINUTES * 60 * 1000;
    const usedIndexes = new Set();
    const missingSlots = [];

    slots.forEach((slot) => {
        const matchedIndex = files.findIndex((file, index) => {
            if (usedIndexes.has(index)) return false;
            const timestamp = file.parsedTime || file.lastModified;
            return Math.abs(timestamp - slot.expectedAt) <= toleranceMs;
        });

        if (matchedIndex >= 0) {
            usedIndexes.add(matchedIndex);
        } else {
            missingSlots.push(slot.label);
        }
    });

    return missingSlots;
};

// [已重构] 检查数据库备份状态
const checkDatabaseBackup = async (client, bucketName, task, db) => {
    console.log(`[OBS巡检-开始] 任务: '${task.name}', 数据库: '${db.name}'`);
    const folderPrefix = `${task.folder}/`;
    const dbFilePrefix = `${db.name}_`;

    console.log(`[OBS巡检-参数] 存储桶: '${bucketName}', 文件夹前缀: '${folderPrefix}', 文件名前缀: '${dbFilePrefix}'`);

    const listing = await client.listObjects({ Bucket: bucketName, Prefix: folderPrefix });
    const now = new Date();
    
    const allObjects = ensureContents(listing.InterfaceResult);
    console.log(`[OBS巡检-原始列表] 在 '${folderPrefix}' 下找到 ${allObjects.length} 个对象。`);
    allObjects.forEach(obj => console.log(` - 原始对象: ${obj.Key}`));

    const bakFiles = allObjects
        .filter(obj => {
            if (!obj.Key.endsWith('.bak')) {
                console.log(`[OBS巡检-过滤] ${obj.Key} -> 跳过 (不是 .bak 文件)`);
                return false;
            }
            const filename = obj.Key.substring(folderPrefix.length);
            const isMatch = filename.startsWith(dbFilePrefix);
            console.log(`[OBS巡检-过滤] 文件: '${filename}', 是否匹配前缀 '${dbFilePrefix}': ${isMatch}`);
            return isMatch;
        })
        .map(obj => ({
            key: obj.Key,
            lastModified: new Date(obj.LastModified),
            parsedTime: parseTimeFromFilename(obj.Key)
        }))
        .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
        
    console.log(`[OBS巡检-结果] 找到 ${bakFiles.length} 个匹配的备份文件。`);

    if (!bakFiles.length) {
        return {
            status: '异常',
            reason: '未发现任何备份文件',
            latest_file_name: 'N/A',
            latest_time: 'N/A',
            expected_slots: [],
            missing_slots: []
        };
    }

    const slots = buildExpectedSlots(db, now);
    const missingSlots = evaluateSlotCoverage(slots, bakFiles);
    const latestFile = bakFiles[0];
    const latestDate = latestFile.parsedTime || latestFile.lastModified;
    const hoursSinceLatest = (now - latestDate) / (1000 * 3600);

    let status = '正常';
    let reason = '备份正常';

    if (missingSlots.length) {
        status = '异常';
        reason = `缺少计划时间：${missingSlots.join(', ')}`;
    } else if (db.backup_frequency === '每小时一次' && hoursSinceLatest > 2) {
        status = '异常';
        reason = `距离上次备份超过 ${hoursSinceLatest.toFixed(1)} 小时`;
    } else if (hoursSinceLatest > 30) {
        status = '异常';
        reason = `超过 ${Math.round(hoursSinceLatest)} 小时未备份`;
    }

    return {
        status,
        reason,
        latest_file_name: latestFile.key.split('/').pop(),
        latest_time: new Date(latestDate).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        expected_slots: slots.map(slot => slot.label),
        missing_slots: missingSlots
    };
};

// [已重构] 清理旧备份
const pruneOldBackups = async (client, bucketName, task, db, retentionCount) => {
    const retention = parseInt(retentionCount, 10);
    if (Number.isNaN(retention) || retention <= 0) {
        console.log(`[OBS清理] 任务 '${task.name}' 数据库 '${db.name}' 的保留数量 (${retentionCount}) 无效或未设置，跳过清理。`);
        return;
    }

    const folderPrefix = `${task.folder}/`;
    const dbFilePrefix = `${db.name}_`;

    const listing = await client.listObjects({ Bucket: bucketName, Prefix: folderPrefix });
    const bakFiles = ensureContents(listing.InterfaceResult).filter(obj => {
        if (!obj.Key.endsWith('.bak')) return false;
        const filename = obj.Key.substring(folderPrefix.length);
        return filename.startsWith(dbFilePrefix);
    });

    if (bakFiles.length <= retention) {
        console.log(`[OBS清理] 检查数据库 '${db.name}' 的文件数量 (${bakFiles.length})，保留数量为 (${retention})，无需清理。`);
        return;
    }

    bakFiles.sort((a, b) => (parseTimeFromFilename(a.Key) || new Date(a.LastModified)) - (parseTimeFromFilename(b.Key) || new Date(b.LastModified)));
    const filesToDelete = bakFiles.slice(0, bakFiles.length - retention);

    if (filesToDelete.length > 0) {
        console.log(`[OBS清理] 文件夹 '${folderPrefix}${db.name}' 发现 ${filesToDelete.length} 个旧备份文件需要删除...`);
        await client.deleteObjects({
            Bucket: bucketName,
            Objects: filesToDelete.map(f => ({ Key: f.Key }))
        });
        console.log(`[OBS清理] 成功删除 ${filesToDelete.length} 个旧备份文件。`);
    }
};

// [已重构] 获取任务文件列表
const listTaskFiles = async (client, bucketName, folder) => {
    const listing = await client.listObjects({ Bucket: bucketName, Prefix: folder });
    return ensureContents(listing.InterfaceResult)
        .filter(obj => obj.Key.endsWith('.bak'))
        .map(obj => ({
            key: obj.Key,
            size: obj.Size,
            lastModified: new Date(obj.LastModified).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        }));
};

module.exports = { getObsClient, checkDatabaseBackup, pruneOldBackups, listTaskFiles };
