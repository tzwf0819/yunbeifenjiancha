module.exports = {
  apps : [{
    name   : "yida-backup-manager",
    script : "./app.js",
    env: {
      "NODE_ENV": "production",
      "PORT": 3000 // 容器内部固定监听3000端口
    }
  }]
}
