# 星星人民公益站 (Antigravity) ✨

[![Vue 3](https://img.shields.io/badge/Vue-3.x-4FC08D?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-4.x-000000?style=flat-square&logo=fastify)](https://www.fastify.io/)
[![Prisma](https://img.shields.io/badge/Prisma-5.x-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker)](https://www.docker.com/)

一个基于社区贡献的 AI 模型 API 代理平台，旨在通过共享算力实现 AI 民主化。支持 Gemini 和 Claude 系列模型。

## 🚀 核心功能

### 1. 反重力系统 (Antigravity)
独特的贡献机制，用户可以通过上传 **Google Service Account JSON** 凭证来贡献算力。系统会自动检测凭证权限，并根据贡献等级解锁高级模型。

*   **普通贡献者**：上传任意有效的 Google Cloud 凭证。
    *   解锁模型：`gemini-2.5-flash`, `gemini-2.5-pro`
    *   每日配额：大幅提升（默认 1500 次/天）
*   **至臻贡献者**：上传拥有 **Vertex AI Gemini 3.0** 权限的凭证。
    *   解锁模型：`gemini-3-pro-preview` (Thinking Model)
    *   每日配额：解锁最高权限（默认 3000 次/天）

### 2. 支持模型列表
平台支持 OpenAI 格式调用，Base URL 为 `https://your-domain.com/v1`。

#### Gemini 系列
| 模型 ID | 说明 | 权限要求 |
| :--- | :--- | :--- |
| `gemini-2.5-flash` | 速度快，成本低 | 注册用户 |
| `gemini-2.5-pro` | 推理能力强 | 注册用户 |
| `gemini-3-pro-preview` | **Gemini 3.0**，支持思维链 (Thinking) | **至臻贡献者** (需上传 V3 凭证) |

#### Claude 系列
| 模型 ID | 说明 | 权限要求 |
| :--- | :--- | :--- |
| `claude-sonnet-4-5` | Claude 4.5 Sonnet | 平台福利 / 反重力池 |
| `claude-opus-4-5` | Claude 4.5 Opus | 平台福利 / 反重力池 |
| `claude-sonnet-4-5-thinking` | Claude 4.5 Sonnet (Thinking) | 平台福利 / 反重力池 |
| `claude-opus-4-5-thinking` | Claude 4.5 Opus (Thinking) | 平台福利 / 反重力池 |

### 3. 用户与权限管理
*   **Discord OAuth**：支持一键登录和账号绑定。
*   **API 密钥管理**：用户可创建多个 API Key，用于第三方客户端（如 NextChat, One API）。
*   **可视化仪表盘**：实时监控今日用量、模型分布、反重力池水位。

## 🛠️ 技术栈

*   **前端**：Vue 3, Vite, Tailwind CSS, Headless UI
*   **后端**：Node.js, Fastify, TypeScript
*   **数据库**：PostgreSQL (数据存储), Redis (缓存与限流)
*   **ORM**：Prisma
*   **部署**：Docker Compose

## 📦 快速部署

### 前置要求
*   Docker & Docker Compose
*   Node.js (仅本地开发需要)

### 1. 克隆项目
```bash
git clone https://github.com/beijixingxing/antigravity.git
cd antigravity
```

### 2. 配置环境变量
复制示例配置文件并修改：
```bash
cp .env.example .env
```
主要配置项：
```ini
# 数据库配置
DATABASE_URL="postgresql://postgres:password@postgres:5432/clicloud?schema=public"
REDIS_URL="redis://:password@redis:6379"

# JWT 密钥 (务必修改)
JWT_SECRET="your-super-secret-key"

# Discord OAuth (可选，用于登录)
DISCORD_CLIENT_ID="your-client-id"
DISCORD_CLIENT_SECRET="your-client-secret"
DISCORD_REDIRECT_URI="https://your-domain.com/api/auth/discord/callback"

# 管理员初始密码 (首次启动时创建)
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="admin-password"
```

### 3. 启动服务
使用 Docker Compose 一键启动：
```bash
docker compose up -d --build
```

容器启动后：
*   前端/API 服务运行在 `3000` 端口。
*   数据库自动迁移。

访问 `http://localhost:3000` 即可看到登录界面。

## 💻 本地开发

```bash
# 1. 安装依赖
npm install
cd client && npm install && cd ..

# 2. 启动数据库 (使用 Docker)
docker compose up -d postgres redis

# 3. 生成 Prisma Client
npx prisma generate

# 4. 启动后端 (开发模式)
npm run dev

# 5. 启动前端 (开发模式)
cd client && npm run dev
```

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！
*   **Bug 反馈**：请提供详细的复现步骤和日志。
*   **功能建议**：请描述使用场景和预期效果。

## 📄 许可证

MIT License