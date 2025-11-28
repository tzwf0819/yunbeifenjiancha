# 使用官方的 Node.js 18 作为基础镜像
FROM node:18-alpine

# 在容器内创建一个工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json (或 yarn.lock)
COPY package*.json ./

# 安装生产环境依赖，并使用淘宝镜像源加速
RUN npm install --production --registry=https://registry.npmmirror.com && npm install pm2 -g --registry=https://registry.npmmirror.com

# 将所有项目文件复制到工作目录
COPY . .

# 声明容器将对外暴露 3000 端口 (实际映射在 docker run 命令中定义)
EXPOSE 3000

# 定义容器启动时运行的命令
# 使用 pm2-runtime 是在 Docker 容器中运行 PM2 的正确方式
CMD ["npm", "start"]
