# 使用 Node.js 官方镜像作为基础
FROM node:20-slim

# 安装 Python 和必要的系统库（pdf2docx 依赖 OpenCV 和 MuPDF，需要这些系统库）
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制依赖文件并安装
COPY package*.json ./
RUN npm install

COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir -r requirements.txt --break-system-packages

# 复制项目所有文件
COPY . .

# 编译前端代码
RUN npm run build

# 暴露端口
EXPOSE 3000

# 生产环境启动（使用 tsx 直接运行 server.ts，NODE_ENV 为 production 时 Vite dev server 不会启动）
CMD ["npx", "tsx", "server.ts"]
