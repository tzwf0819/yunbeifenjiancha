const { getBucketStatus } = require('../shared/core-logic');
const fs = require('fs');
const path = require('path');
const mustache = require('mustache');

exports.main = async (event, context) => {
    // 从共享模块获取存储桶状态
    const { review_results, bucket_files, expired_buckets } = await getBucketStatus();

    // 加载HTML模板
    const templatePath = path.resolve(__dirname, 'template.html');
    const template = fs.readFileSync(templatePath, 'utf-8');

    // 准备视图数据
    const viewData = {
        last_updated: new Date().toLocaleString(),
        review_results,
        bucket_files,
        expired_buckets,
        has_abnormal: review_results.some(r => r.status === '异常'),
        has_expired: expired_buckets.length > 0,
        // 增加一个辅助函数来判断状态
        isNormal: function() {
            return this.status === '正常';
        }
    };

    // 使用mustache渲染HTML
    const html = mustache.render(template, viewData);

    // 作为HTTP响应返回HTML内容
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'text/html',
        },
        body: html
    };
};