
# 使用官方Node.js 18镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /usr/src/app

# 安装pm2进程管理器
RUN npm install pm2 -g

# 复制package.json和package-lock.json
COPY package*.json ./

# 安装项目依赖
RUN npm install

# 复制所有项目文件
COPY . .

# 暴露应用端口
EXPOSE 3000

# 使用pm2-runtime启动应用，这是为容器环境优化的命令
CMD ["pm2-runtime", "app.js"]
