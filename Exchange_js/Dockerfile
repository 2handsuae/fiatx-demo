# 后端（NestJS + Prisma）—— 单阶段：构建 + 运行 seed + 起服务
# 单阶段更稳：seed/demo 走 ts-node，需要 src/ + tsconfig + node_modules 同在。
FROM node:20-bookworm-slim
WORKDIR /app

# netcat: 探测 TigerBeetle / backend 端口就绪（无 /health 端点，用端口探测）
RUN apt-get update && apt-get install -y --no-install-recommends netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
ENTRYPOINT ["bash", "/app/docker/backend-entrypoint.sh"]
