# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /app

# 1. Install Dependencies
COPY package*.json ./
RUN npm install

# 2. Copy Code
COPY . .

# 3. Build Backend
RUN npx prisma generate
RUN npx tsc

# 3. Build Frontend（使用项目内默认 outDir，通常是 dist/public）
RUN npx vite build

# Stage 2: Runner
FROM node:22-alpine AS runner

# Set Timezone and add glibc compatibility (for TLS requester binary)
RUN apk add --no-cache tzdata libc6-compat
ENV TZ=Asia/Shanghai

WORKDIR /app
ENV NODE_ENV=production

# 1. Install Prod Deps
COPY package*.json ./
RUN npm install --omit=dev

# 2. Copy Backend Artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# 3. Frontend 已在 /app/dist/public，随 dist 一并复制，无需单独复制

# 4. Copy TLS Requester Binary (Antigravity)
COPY --from=builder /app/src/bin ./src/bin
RUN chmod +x ./src/bin/antigravity_requester_linux_amd64 2>/dev/null || true

# 5. Copy Start Script
COPY scripts/start.sh ./start.sh
RUN sed -i 's/\r$//' ./start.sh
RUN chmod +x ./start.sh

# 6. Generate Client
RUN npx prisma generate

EXPOSE 3000

CMD ["./start.sh"]
