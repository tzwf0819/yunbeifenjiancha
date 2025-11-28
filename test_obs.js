// test_obs.js

// 引入所需的模块
const fs = require('fs');
const path = require('path');
const ObsClient = require('esdk-obs-nodejs');

console.log('--- 开始OBS权限独立测试 ---');

// 1. 读取配置文件
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
    console.error(`错误：配置文件 'config.json' 未找到。`);
    process.exit(1);
}

let config;
try {
    const configFile = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(configFile);
} catch (error) {
    console.error(`错误：读取或解析 'config.json' 失败:`, error);
    process.exit(1);
}

const obsConfig = config.huawei_obs;
const taskConfig = config.tasks && config.tasks[0]; // 使用第一个任务作为测试目标

// 2. 检查配置是否完整
if (!obsConfig || !obsConfig.ak || !obsConfig.sk || !obsConfig.endpoint || !obsConfig.bucket_name) {
    console.error('错误：config.json 中的 huawei_obs 配置不完整。');
    process.exit(1);
}
if (!taskConfig || !taskConfig.folder) {
    console.error('错误：config.json 中缺少有效的任务配置或 folder 字段。');
    process.exit(1);
}

console.log(`测试参数:`);
console.log(` - 存储桶 (Bucket): ${obsConfig.bucket_name}`);
console.log(` - 区域 (Endpoint): ${obsConfig.endpoint}`);
console.log(` - AK: ${obsConfig.ak.substring(0, 4)}...`); // 不暴露完整AK
console.log(` - 文件夹 (Prefix): ${taskConfig.folder}/`);

// 3. 初始化OBS客户端
let obsClient;
try {
    obsClient = new ObsClient({
        access_key_id: obsConfig.ak,
        secret_access_key: obsConfig.sk,
        server: obsConfig.endpoint
    });
} catch (error) {
    console.error('错误：初始化OBS客户端失败:', error);
    process.exit(1);
}

// 4. 执行列举对象操作
async function testListObjects() {
    try {
        console.log('\n正在尝试列出存储桶中的对象...');
        const result = await obsClient.listObjects({
            Bucket: obsConfig.bucket_name,
            Prefix: `${taskConfig.folder}/`
        });

        if (result.CommonMsg.Status < 300) {
            console.log('操作成功！API返回状态码:', result.CommonMsg.Status);
            if (result.InterfaceResult.Contents && result.InterfaceResult.Contents.length > 0) {
                console.log(`成功列出 ${result.InterfaceResult.Contents.length} 个对象:`);
                result.InterfaceResult.Contents.forEach(obj => {
                    console.log(`  - ${obj.Key} (大小: ${obj.Size}, 修改时间: ${obj.LastModified})`);
                });
            } else {
                console.log('操作成功，但未在指定的文件夹下找到任何对象。');
                console.log('\n--- 分析 ---');
                console.log('这通常意味着两件事之一:');
                console.log('1. 指定的文件夹确实是空的。');
                console.log('2. 您使用的密钥(AK/SK)没有 \"obs:ListBucket\" 权限来查看此存储桶中的对象列表。');
                console.log('既然您已确认文件存在，权限问题是最大可能的原因。');
            }
        } else {
            console.error('--- 操作失败 ---');
            console.error('OBS服务器返回了错误状态。');
            console.error('状态码:', result.CommonMsg.Status);
            console.error('错误码:', result.CommonMsg.Code);
            console.error('错误信息:', result.CommonMsg.Message);
            console.log('\n--- 分析 ---');
            console.log('这个错误直接来自华为云OBS服务器。请检查错误码和错误信息以定位问题。常见的错误包括 InvalidAccessKeyId (AK无效) 或 SignatureDoesNotMatch (SK错误)。');
        }

    } catch (error) {
        console.error('--- 发生严重错误 ---');
        console.error('在与OBS通信期间发生异常:', error);
    } finally {
        if (obsClient) {
            obsClient.close();
        }
        console.log('\n--- 测试结束 ---');
    }
}

// 运行测试
testListObjects();
