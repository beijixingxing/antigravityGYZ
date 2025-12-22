import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { antigravityTokenManager } from '../services/AntigravityTokenManager';
import { AntigravityService } from '../services/AntigravityService';
import { ANTIGRAVITY_MODELS } from '../config/antigravityConfig';
import { generateSessionId } from '../utils/antigravityUtils';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// OAuth 配置 (与原始 antigravity 项目一致)
const OAUTH_CONFIG = {
    clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
    clientSecret: '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',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/cclog',
        'https://www.googleapis.com/auth/experimentsandconfigs'
    ]
};

/**
 * 验证用户登录 (不需要管理员) - 返回用户 ID 或 null
 */
async function verifyAuth(req: FastifyRequest, reply: FastifyReply): Promise<number | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Missing authorization header' });
        return null;
    }

    const token = authHeader.replace('Bearer ', '');

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        // 注意: auth.ts 中签发的 token 使用 id 而不是 userId
        const userId = decoded.id || decoded.userId;

        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) {
            console.error(`[Auth] User not found for ID: ${userId}`);
            reply.code(401).send({ error: 'User not found' });
            return null;
        }

        return userId;
    } catch (e: any) {
        console.error('[Auth] Token verification failed:', e.message);
        reply.code(401).send({ error: 'Invalid token: ' + e.message });
        return null;
    }
}

/**
 * 验证管理员权限
 */
async function verifyAdmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Missing authorization header' });
        return false;
    }

    const token = authHeader.replace('Bearer ', '');

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        // 注意: auth.ts 中签发的 token 使用 id 而不是 userId
        const userId = decoded.id || decoded.userId;

        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user || user.role !== 'ADMIN') {
            reply.code(403).send({ error: 'Admin access required' });
            return false;
        }

        return true;
    } catch (e: any) {
        console.error('[Admin] Token verification failed:', e.message);
        reply.code(401).send({ error: 'Invalid token' });
        return false;
    }
}

export default async function antigravityAdminRoutes(app: FastifyInstance) {

    // 获取反重力配置
    app.get('/config', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;

        const setting = await prisma.systemSetting.findUnique({ where: { key: 'ANTIGRAVITY_CONFIG' } });
        let config = { claude_limit: 100, gemini3_limit: 200, rate_limit: 30, rate_limit_increment: 30 };

        if (setting) {
            try {
                config = { ...config, ...JSON.parse(setting.value) };
            } catch (e) {
                console.error('Failed to parse ANTIGRAVITY_CONFIG', e);
            }
        }

        return config;
    });

    // 原始额度响应调试 (仅管理员)
    app.get('/tokens/:id/quotas/raw', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;
        const { id } = req.params as { id: string };
        const tokenId = parseInt(id);
        const token = await prisma.antigravityToken.findUnique({ where: { id: tokenId } });
        if (!token) {
            return reply.code(404).send({ error: 'Not found' });
        }
        const tokenData = {
            id: token.id,
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_in: token.expires_in,
            timestamp: token.timestamp,
            project_id: token.project_id,
            session_id: generateSessionId()
        };
        try {
            const raw = await AntigravityService.getModelsWithQuotas(tokenData as any);
            return reply.send({ raw });
        } catch (e: any) {
            return reply.code(500).send({ error: e.message || 'Failed to fetch raw quotas' });
        }
    });

    // 更新反重力配置
    app.post('/config', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;

        const body = req.body as any;
        const {
            claude_limit, gemini3_limit, rate_limit,
            increment_per_token_claude, increment_per_token_gemini3,
            use_token_quota, claude_token_quota, gemini3_token_quota,
            increment_token_per_token_claude, increment_token_per_token_gemini3,
            rate_limit_increment
        } = body;

        // Validation (basic)
        if (
            (claude_limit !== undefined && typeof claude_limit !== 'number') ||
            (gemini3_limit !== undefined && typeof gemini3_limit !== 'number')
        ) {
            return reply.code(400).send({ error: 'Invalid limits. Must be numbers.' });
        }

        const config = {
            claude_limit,
            gemini3_limit,
            rate_limit: typeof rate_limit === 'number' ? rate_limit : 30,
            rate_limit_increment: typeof rate_limit_increment === 'number' ? rate_limit_increment : 30,
            increment_per_token_claude: typeof increment_per_token_claude === 'number' ? increment_per_token_claude : 0,
            increment_per_token_gemini3: typeof increment_per_token_gemini3 === 'number' ? increment_per_token_gemini3 : 0,
            use_token_quota: !!use_token_quota,
            claude_token_quota: typeof claude_token_quota === 'number' ? claude_token_quota : 100000,
            gemini3_token_quota: typeof gemini3_token_quota === 'number' ? gemini3_token_quota : 200000,
            increment_token_per_token_claude: typeof increment_token_per_token_claude === 'number' ? increment_token_per_token_claude : 0,
            increment_token_per_token_gemini3: typeof increment_token_per_token_gemini3 === 'number' ? increment_token_per_token_gemini3 : 0
        };

        await prisma.systemSetting.upsert({
            where: { key: 'ANTIGRAVITY_CONFIG' },
            update: { value: JSON.stringify(config) },
            create: { key: 'ANTIGRAVITY_CONFIG', value: JSON.stringify(config) }
        });

        // Audit Log (Optional but good practice)
        console.log(`[Admin] Antigravity config updated:`, config);

        return { success: true, config };
    });

    // 获取反重力全局统计数据 (管理员)
    app.get('/stats', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;

        const utc8Offset = 8 * 60 * 60 * 1000;
        const todayStr = new Date(Date.now() + utc8Offset).toISOString().split('T')[0];

        // 1. Get Global Usage from Redis (Dual Counters)
        const requestsUsage = await redis.hgetall(`AG_GLOBAL:requests:${todayStr}`);
        const tokensUsage = await redis.hgetall(`AG_GLOBAL:tokens:${todayStr}`);
        // Fallback for legacy keys (if new keys empty, try old)
        const legacyUsage = await redis.hgetall(`AG_GLOBAL:${todayStr}`);

        const claudeRequests = parseInt(requestsUsage?.claude || legacyUsage?.claude || '0', 10);
        const gemini3Requests = parseInt(requestsUsage?.gemini3 || legacyUsage?.gemini3 || '0', 10);

        const claudeTokens = parseInt(tokensUsage?.claude || '0', 10);
        const gemini3Tokens = parseInt(tokensUsage?.gemini3 || '0', 10);

        // 2. Get Token Count (Active + Cooling)
        // 冷却的凭证仍然算入容量，只有 DEAD 的不算
        const activeTokens = await prisma.antigravityToken.count({
            where: { status: { in: ['ACTIVE', 'COOLING'] }, is_enabled: true }
        });

        // 3. Get Config for Limits
        const setting = await prisma.systemSetting.findUnique({ where: { key: 'ANTIGRAVITY_CONFIG' } });
        let config = { claude_limit: 100, gemini3_limit: 200, claude_token_quota: 100000, gemini3_token_quota: 200000, rate_limit: 30, rate_limit_increment: 30 };
        if (setting) {
            try { config = { ...config, ...JSON.parse(setting.value) }; } catch (e) { }
        }

        // 4. Calculate "Capacity" (Fixed per-credential quota for admin view)
        // Claude: 100 requests per credential, Gemini3: 250 requests per credential
        const claudeCapacityRequests = activeTokens * 100;
        const gemini3CapacityRequests = activeTokens * 250;

        // Token quotas: Claude 100k per credential, Gemini3 250k per credential
        const claudeCapacityTokens = activeTokens * 100000;
        const gemini3CapacityTokens = activeTokens * 250000;

        // 5. Get Antigravity Leaderboard (Top 25 by total usage)
        const useTokenQuota = !!(config as any).use_token_quota;
        const allUsers = await prisma.user.findMany({
            select: { id: true, email: true, discordUsername: true, discordAvatar: true }
        });

        // Get usage for each user from Redis
        const leaderboard: { id: number; email: string; discordUsername: string | null; discordAvatar: string | null; claude: number; gemini3: number; total: number }[] = [];

        for (const user of allUsers) {
            const claudeReqKey = `USAGE:requests:${todayStr}:${user.id}:antigravity:claude`;
            const geminiReqKey = `USAGE:requests:${todayStr}:${user.id}:antigravity:gemini3`;
            const claudeTokKey = `USAGE:tokens:${todayStr}:${user.id}:antigravity:claude`;
            const geminiTokKey = `USAGE:tokens:${todayStr}:${user.id}:antigravity:gemini3`;

            let claudeUsage = 0;
            let geminiUsage = 0;

            if (useTokenQuota) {
                claudeUsage = parseInt((await redis.get(claudeTokKey)) || '0', 10);
                geminiUsage = parseInt((await redis.get(geminiTokKey)) || '0', 10);
            } else {
                claudeUsage = parseInt((await redis.get(claudeReqKey)) || '0', 10);
                geminiUsage = parseInt((await redis.get(geminiReqKey)) || '0', 10);
            }

            const total = claudeUsage + geminiUsage;
            if (total > 0) {
                leaderboard.push({
                    id: user.id,
                    email: user.email,
                    discordUsername: user.discordUsername,
                    discordAvatar: user.discordAvatar,
                    claude: claudeUsage,
                    gemini3: geminiUsage,
                    total
                });
            }
        }

        // Sort by total usage and take top 25
        leaderboard.sort((a, b) => b.total - a.total);
        const top25 = leaderboard.slice(0, 25);

        // 6. Get Token Stats (Total, Active, Inactive, Total Capacity)
        const totalTokens = await prisma.antigravityToken.count();
        const inactiveTokens = await prisma.antigravityToken.count({ where: { is_enabled: false } });
        // activeTokens already calculated above (includes COOLING)
        
        // Calculate total capacity based on active tokens
        // Assuming 250k tokens per active credential for Gemini 3.0 as a baseline for "Total Capacity" display
        // Or use requests capacity if not in token mode
        const totalCapacityDisplay = useTokenQuota ? (activeTokens * 250000) : (activeTokens * 250);

        return {
            date: todayStr,
            usage: {
                requests: {
                    claude: claudeRequests,
                    gemini3: gemini3Requests
                },
                tokens: {
                    claude: claudeTokens,
                    gemini3: gemini3Tokens
                }
            },
            capacity: {
                requests: {
                    claude: claudeCapacityRequests,
                    gemini3: gemini3CapacityRequests
                },
                tokens: {
                    claude: claudeCapacityTokens,
                    gemini3: gemini3CapacityTokens
                }
            },
            meta: {
                active_tokens: activeTokens,
                limits: config
            },
            token_stats: {
                total: totalTokens,
                active: activeTokens,
                inactive: inactiveTokens,
                total_capacity: totalCapacityDisplay
            },
            leaderboard: top25
        };
    });

    // 获取用户反重力使用详情 (管理员)
    app.get('/usage/:userId', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;

        const { userId } = req.params as any;
        const utc8Offset = 8 * 60 * 60 * 1000;
        const todayStr = new Date(Date.now() + utc8Offset).toISOString().split('T')[0];

        // Dual keys
        const claudeRequests = await redis.get(`USAGE:requests:${todayStr}:${userId}:antigravity:claude`);
        const gemini3Requests = await redis.get(`USAGE:requests:${todayStr}:${userId}:antigravity:gemini3`);
        const claudeTokens = await redis.get(`USAGE:tokens:${todayStr}:${userId}:antigravity:claude`);
        const gemini3Tokens = await redis.get(`USAGE:tokens:${todayStr}:${userId}:antigravity:gemini3`);

        // Legacy fallback
        const claudeLegacy = await redis.get(`USAGE:${todayStr}:${userId}:antigravity:claude`);
        const gemini3Legacy = await redis.get(`USAGE:${todayStr}:${userId}:antigravity:gemini3`);

        return {
            date: todayStr,
            userId: parseInt(userId),
            usage: {
                requests: {
                    claude: parseInt(claudeRequests || claudeLegacy || '0', 10),
                    gemini3: parseInt(gemini3Requests || gemini3Legacy || '0', 10)
                },
                tokens: {
                    claude: parseInt(claudeTokens || '0', 10),
                    gemini3: parseInt(gemini3Tokens || '0', 10)
                }
            }
        };
    });

    // 获取 Token 列表 (仅管理员)
    app.get('/tokens', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;

        const query = req.query as any;
        const page = Math.max(1, parseInt(query.page) || 1);
        const limit = Math.min(Math.max(1, parseInt(query.limit) || 10), 100);
        const sortBy = query.sort_by || 'id';
        const order = query.order === 'desc' ? 'desc' : 'asc';
        const status = query.status as string | undefined;
        const pool = query.pool as string | undefined;

        const { tokens, total } = await antigravityTokenManager.getTokenList(page, limit, sortBy, order, status);

        const baseStats = await antigravityTokenManager.getStats();
        const setting = await prisma.systemSetting.findUnique({ where: { key: 'SYSTEM_CONFIG' } });
        let personalMax = 0;
        try {
            const conf = setting ? JSON.parse(setting.value) : {};
            personalMax = conf?.quota?.personal_max_usage ?? 0;
        } catch { }
        const inactive = await prisma.antigravityToken.count({ where: { is_enabled: false } });
        const totalCapacity = personalMax > 0 ? personalMax * baseStats.active : 0;
        const stats = { ...baseStats, inactive, personal_max_usage: personalMax, total_capacity: totalCapacity };

        // enrich tokens with quota cache classification and remaining
        const enriched = await Promise.all(tokens.map(async (t: any) => {
            const cached = (await import('../services/AntigravityQuotaCache')).antigravityQuotaCache.get(t.id);
            return {
                ...t,
                classification: cached?.classification || null,
                remaining: typeof cached?.remaining === 'number' ? cached?.remaining : null,
                window_hours: typeof cached?.window_hours === 'number' ? cached?.window_hours : null
            };
        }));
        const filtered = pool === 'Pro' ? enriched.filter((x: any) => x.classification === 'Pro')
            : pool === 'Normal' ? enriched.filter((x: any) => x.classification !== 'Pro') : enriched;

        return {
            tokens: filtered,
            stats,
            meta: {
                total: pool ? filtered.length : total,
                page,
                limit,
                total_pages: Math.ceil((pool ? filtered.length : total) / limit)
            }
        };
    });

    // 添加 Token (仅管理员)
    app.post('/tokens', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;

        const body = req.body as any;

        if (!body.access_token || !body.refresh_token || !body.owner_id) {
            return reply.code(400).send({ error: 'access_token, refresh_token, and owner_id are required' });
        }

        try {
            // 验证账号是否有 Antigravity 权限 (通过实际调用 gemini-2.5-flash)
            let projectId: string | undefined = body.projectId;
            try {
                // 1. 如果没有 projectId，尝试获取 (可选，如果用户没填)
                if (!projectId) {
                    try {
                        const projectRes = await axios.post(
                            'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist',
                            { metadata: { ideType: 'ANTIGRAVITY' } },
                            {
                                headers: {
                                    'Host': 'daily-cloudcode-pa.sandbox.googleapis.com',
                                    'Authorization': `Bearer ${body.access_token}`,
                                    'Content-Type': 'application/json',
                                    'User-Agent': 'antigravity/1.11.9 windows/amd64'
                                }
                            }
                        );
                        projectId = projectRes.data?.cloudaicompanionProject;
                    } catch (e) {
                        console.warn('[Antigravity] Failed to fetch projectId via loadCodeAssist, proceeding if projectId provided manually or assuming valid later.');
                    }
                }

                // 2. 如果还是没有 projectId，报错
                if (!projectId) {
                    return reply.code(400).send({ error: '无法获取 projectId，请手动在请求中提供 projectId' });
                }

                // 3. 使用 CredentialService 进行实际生成测试
                // 借用 CredentialService 的 verifyCloudCodeAccess 方法
                // 注意：CredentialService 需要实例化
                const { CredentialService } = require('../services/CredentialService');
                const credentialService = new CredentialService();

                // 验证 gemini-2.5-flash (基础反重力能力)
                const isValid = await credentialService.verifyCloudCodeAccess(body.access_token, projectId, 'gemini-2.5-flash');

                if (!isValid) {
                    // verifyCloudCodeAccess returns false only on internal error, usually throws on API error
                    // If it returned false without throwing, it means response parsing failed
                    return reply.code(400).send({ error: '验证失败：API 返回了无效的响应格式' });
                }

            } catch (e: any) {
                console.error('[Antigravity] Token validation failed:', e.message);
                const status = e.response?.status;
                const err = e.response?.data?.error;
                const message = err?.message || e.message;

                // 如果是 403，说明确实没权限调用模型
                if (message.includes('403') || status === 403) {
                    return reply.code(400).send({ error: '权限验证失败 (403)：该凭证无法调用 Gemini 模型。请确保账号已开通相关权限。' });
                }

                return reply.code(400).send({ error: '验证失败: ' + message });
            }
            const token = await antigravityTokenManager.addToken({
                access_token: body.access_token,
                refresh_token: body.refresh_token,
                expires_in: body.expires_in,
                email: body.email,
                projectId,
                ownerId: body.owner_id
            });

            return { success: true, token: { id: token.id } };
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // 更新 Token (启用/禁用) (仅管理员)
    app.put('/tokens/:id', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;

        const { id } = req.params as { id: string };
        const body = req.body as any;

        try {
            const token = await antigravityTokenManager.updateToken(parseInt(id), {
                is_enabled: body.is_enabled
            });

            return { success: true, token };
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // 删除 Token (仅管理员)
    app.delete('/tokens/:id', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;

        const { id } = req.params as { id: string };

        try {
            await antigravityTokenManager.deleteToken(parseInt(id));
            return { success: true };
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // 刷新所有凭证额度缓存 (仅管理员)
    app.get('/quotas/refresh', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;
        const tokens = await prisma.antigravityToken.findMany({
            where: { is_enabled: true, status: 'ACTIVE' },
            select: { id: true, access_token: true, refresh_token: true, expires_in: true, timestamp: true, project_id: true }
        });
        const { antigravityQuotaCache } = require('../services/AntigravityQuotaCache');
        const results: any[] = [];
        let refreshed = 0;
        for (const t of tokens) {
            const tokenData = {
                id: t.id,
                access_token: t.access_token,
                refresh_token: t.refresh_token,
                expires_in: t.expires_in,
                timestamp: t.timestamp,
                project_id: t.project_id,
                session_id: generateSessionId()
            };
            try {
                await antigravityQuotaCache.refreshToken(tokenData);
                refreshed++;
                results.push({ id: t.id, status: 'ok' });
            } catch (e: any) {
                const status = e.statusCode || e.response?.status;
                const msg = e.message || '';
                results.push({ id: t.id, status: 'error', code: status || 'unknown', message: msg });
            }
        }
        return { success: true, refreshed, total: tokens.length, results };
    });

    // 凭证池总览 (仅管理员)
    app.get('/pools/overview', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;
        const tokens = await prisma.antigravityToken.findMany({
            where: { is_enabled: true, status: { in: ['ACTIVE', 'COOLING'] } },
            select: { id: true, status: true }
        });
        const { antigravityQuotaCache } = require('../services/AntigravityQuotaCache');
        let normal = 0, pro = 0;
        const normalVals: number[] = [];
        const proVals: number[] = [];
        for (const t of tokens) {
            const c = antigravityQuotaCache.get(t.id);
            if (c?.classification === 'Pro') {
                pro++;
                if (typeof c.remaining === 'number') proVals.push(c.remaining);
            } else {
                normal++;
                if (typeof c?.remaining === 'number') normalVals.push(c.remaining);
            }
        }
        const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        return {
            counts: { normal, pro, active: tokens.filter(t => t.status === 'ACTIVE').length, cooling: tokens.filter(t => t.status === 'COOLING').length },
            remaining: { normal_avg: avg(normalVals), pro_avg: avg(proVals) },
            last_quota_refresh_at: new Date().toISOString()
        };
    });

    // 查询指定 Token 的模型额度与刷新窗口分类 (仅管理员)
    const lastQuotaPull: Map<number, number> = new Map();
    app.get('/tokens/:id/quotas', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;
        const { id } = req.params as { id: string };
        const { force } = req.query as any;
        const tokenId = parseInt(id);
        const token = await prisma.antigravityToken.findUnique({ where: { id: tokenId } });
        if (!token) {
            return reply.code(404).send({ error: 'Not found' });
        }
        const tokenData = {
            id: token.id,
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_in: token.expires_in,
            timestamp: token.timestamp,
            project_id: token.project_id,
            session_id: generateSessionId()
        };
        try {
            // ensure token is fresh before fetching quotas
            try {
                await antigravityTokenManager.refreshToken(tokenId);
            } catch {}
            const freshToken = await prisma.antigravityToken.findUnique({ where: { id: tokenId } }) || token;
            const tokenDataFresh = {
                id: freshToken.id,
                access_token: freshToken.access_token,
                refresh_token: freshToken.refresh_token,
                expires_in: freshToken.expires_in,
                timestamp: freshToken.timestamp,
                project_id: freshToken.project_id,
                session_id: generateSessionId()
            };
            const cached = (await import('../services/AntigravityQuotaCache')).antigravityQuotaCache.get(tokenId);
            const nowTs = Date.now();
            const minIntervalMs = 30000;
            const lastTs = lastQuotaPull.get(tokenId) || 0;
            let quotas: Record<string, any> | null = null;
            let from_cache = false;
            // use cache unless force or cache missing
            if (cached && !force) {
                quotas = Object.fromEntries(cached.per_model.map(pm => [pm.model_id, {
                    remaining: pm.remaining,
                    resetTime: pm.reset_time,
                    windowSeconds: null
                }]));
                from_cache = true;
            }
            if (!quotas) {
                // throttle frequent pulls
                if (!force && nowTs - lastTs < minIntervalMs && cached) {
                    quotas = Object.fromEntries(cached.per_model.map(pm => [pm.model_id, {
                        remaining: pm.remaining,
                        resetTime: pm.reset_time,
                        windowSeconds: null
                    }]));
                    from_cache = true;
                } else {
                    quotas = await AntigravityService.getModelsWithQuotas(tokenDataFresh as any);
                    lastQuotaPull.set(tokenId, nowTs);
                    // refresh cache snapshot
                    const { antigravityQuotaCache } = await import('../services/AntigravityQuotaCache');
                    await antigravityQuotaCache.refreshToken(tokenDataFresh as any);
                }
            }
            const now = Date.now();
            const items = Object.entries(quotas).map(([model_id, q]: [string, any]) => {
                const reset = q.resetTime ? new Date(q.resetTime).getTime() : null;
                let hours: number | null = reset ? Math.max(0, (reset - now) / 3600000) : null;
                if (hours == null && typeof q.windowSeconds === 'number') {
                    hours = q.windowSeconds / 3600;
                }
                return {
                    model_id,
                    remaining: typeof q.remaining === 'number' ? q.remaining : q.remainingFraction ?? null,
                    reset_time: q.resetTime || null,
                    hours_to_reset: hours
                };
            });
            const hoursList = items.map(i => i.hours_to_reset).filter((v): v is number => typeof v === 'number');
            let medianHours = 0;
            if (hoursList.length > 0) {
                const sorted = [...hoursList].sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                medianHours = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
            }
            const target5 = 5;
            const target168 = 168;
            const diff5 = Math.abs(medianHours - target5);
            const diff168 = Math.abs(medianHours - target168);
            const classification = hoursList.length > 0 ? (diff5 <= diff168 ? 'Pro' : 'Normal') : null;
            const window_hours = hoursList.length > 0 ? medianHours : null;
            const window_label = window_hours
                ? (Math.abs(window_hours - 5) <= Math.abs(window_hours - 168) ? '~5h' : '~7d')
                : null;
            return {
                token_id: tokenId,
                classification,
                window_hours,
                window_label,
                models: items,
                meta: { count_with_quota: items.length, fetched_at: new Date().toISOString(), from_cache }
            };
        } catch (e: any) {
            const status = e.statusCode || e.response?.status;
            const message = e.message || e.response?.data?.error?.message || 'Unknown error';
            if (status === 403) {
                return reply.code(403).send({ error: '该凭证无权限查看额度', detail: message });
            }
            return reply.code(typeof status === 'number' ? status : 500).send({ error: message });
        }
    });

    // 获取 OAuth URL (所有登录用户)
    // 返回一个随机端口的 OAuth URL，用户需要记住这个端口
    app.get('/oauth/url', async (req, reply) => {
        if (!await verifyAuth(req, reply)) return;

        // 生成一个随机端口 (50000-60000)
        const port = Math.floor(Math.random() * 10000) + 50000;
        const redirectUri = `http://localhost:${port}/oauth-callback`;

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `access_type=offline` +
            `&client_id=${encodeURIComponent(OAUTH_CONFIG.clientId)}` +
            `&prompt=consent` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&response_type=code` +
            `&scope=${encodeURIComponent(OAUTH_CONFIG.scopes.join(' '))}` +
            `&state=${Date.now()}`;

        return { url: authUrl, port };
    });

    // OAuth 交换 (所有登录用户)
    // 接收完整的回调 URL，提取 code 和 port
    app.post('/oauth/exchange', async (req, reply) => {
        const userId = await verifyAuth(req, reply);
        if (userId === null) return;

        const body = req.body as any;
        const { code, port, skip_project_id } = body;

        if (!code || !port) {
            return reply.code(400).send({ error: 'code 和 port 是必填的' });
        }

        try {
            const redirectUri = `http://localhost:${port}/oauth-callback`;

            // 交换 Token
            const tokenResponse = await axios.post(OAUTH_CONFIG.tokenUrl,
                new URLSearchParams({
                    code,
                    client_id: OAUTH_CONFIG.clientId,
                    client_secret: OAUTH_CONFIG.clientSecret,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code'
                }).toString(),
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            );

            const { access_token, refresh_token, expires_in } = tokenResponse.data;

            if (!access_token) {
                return reply.code(400).send({ error: 'Token 交换失败' });
            }

            if (!refresh_token) {
                return reply.code(400).send({ error: '未获取到 refresh_token，请撤销应用授权后重试' });
            }

            // 获取用户邮箱
            let email: string | undefined;
            try {
                const userInfo = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: {
                        'Host': 'www.googleapis.com',
                        'User-Agent': 'Go-http-client/1.1',
                        'Authorization': `Bearer ${access_token}`,
                        'Accept-Encoding': 'gzip'
                    }
                });
                email = userInfo.data.email;
                console.log('[OAuth] 获取到用户邮箱:', email);
            } catch (e) {
                console.warn('[OAuth] 获取用户邮箱失败');
            }

            // 验证凭证权限 (403 错误始终阻止上传，其他错误可通过 skip_project_id 跳过)
            console.log('[OAuth] 开始验证凭证权限...');
            const testToken = {
                id: 0,
                access_token,
                refresh_token,
                expires_in: expires_in || 3599,
                timestamp: BigInt(Date.now()),
                project_id: null,
                session_id: generateSessionId()
            };
            const testMessages = [{ role: 'user', content: 'hi' }];
            const testModel = ANTIGRAVITY_MODELS[0] || 'gemini-3-pro-preview';
            console.log(`[OAuth] 使用模型 ${testModel} 进行验证测试...`);

                try {
                const result = await AntigravityService.generateResponse(
                    testMessages,
                    testModel,
                    {},
                    undefined,
                    testToken as any,
                    { retry_on_429: true, max_retries: 3 }
                );
                console.log('[OAuth] 验证测试返回, 响应内容:', JSON.stringify(result).substring(0, 200));

                // 检查响应是否有效 - 如果 content 为空且没有 toolCalls，视为失败
                // 注意：空响应验证不能跳过！
                if (!result.content && (!result.toolCalls || result.toolCalls.length === 0)) {
                    console.log('[OAuth] 验证失败: 响应内容为空');
                    return reply.code(400).send({ error: '验证失败：API 返回空响应，该凭证无法正常使用。' });
                } else {
                    console.log('[OAuth] 验证测试成功');
                }
            } catch (e: any) {
                const msg = e.message || '';
                console.log('[OAuth] 验证测试失败:', msg);

                // 403 错误始终阻止上传（权限问题无法通过跳过解决）
                if (msg.includes('403') || (e.statusCode === 403)) {
                    return reply.code(400).send({ error: '权限验证失败 (403)：该凭证无法调用 Antigravity 渠道模型。请确保账号已开通相关权限。' });
                }

                // 只有 Project ID 相关的错误可以通过勾选跳过
                // 检查是否是 Project ID 相关的错误
                const isProjectIdError = msg.toLowerCase().includes('project') || msg.includes('INVALID_ARGUMENT');

                if (!isProjectIdError || !skip_project_id) {
                    return reply.code(400).send({ error: '验证 Antigravity 权限失败: ' + msg });
                }

                // 用户勾选了跳过 Project ID 认证，且确实是 Project ID 相关错误，继续保存
                console.warn(`[OAuth] 用户 ${userId} 选择跳过 Project ID 认证, 错误: ${msg}`);
            }



            // 保存 Token (绑定到当前用户)
            const token = await antigravityTokenManager.addToken({
                access_token,
                refresh_token,
                expires_in,
                email,
                projectId: undefined,
                ownerId: userId
            });

            return { success: true, token: { id: token.id, email, projectId: token.project_id } };
        } catch (e: any) {
            console.error('[OAuth] Token 交换失败:', e.response?.data || e.message);
            return reply.code(500).send({
                error: e.response?.data?.error_description || e.response?.data?.error || e.message
            });
        }
    });

    // 本地 JSON 凭证上传 (所有登录用户)
    // 接收包含 refresh_token 的 OAuth JSON 文件
    app.post('/upload-local', async (req, reply) => {
        const userId = await verifyAuth(req, reply);
        if (userId === null) return;

        const body = req.body as any;
        const { json_content, skip_project_id } = body;

        if (!json_content) {
            return reply.code(400).send({ error: 'json_content 是必填的' });
        }

        try {
            // 解析 JSON 内容
            let credData: any;
            try {
                credData = typeof json_content === 'string' ? JSON.parse(json_content) : json_content;
            } catch (e) {
                return reply.code(400).send({ error: '无效的 JSON 格式' });
            }

            // 检查必需字段
            const refresh_token = credData.refresh_token;
            if (!refresh_token) {
                return reply.code(400).send({ error: 'JSON 中缺少 refresh_token 字段，请确保上传的是 OAuth 凭证文件' });
            }

            // 使用 refresh_token 获取 access_token
            console.log('[Upload Local] 使用 refresh_token 获取 access_token...');
            const tokenResponse = await axios.post(OAUTH_CONFIG.tokenUrl,
                new URLSearchParams({
                    refresh_token,
                    client_id: OAUTH_CONFIG.clientId,
                    client_secret: OAUTH_CONFIG.clientSecret,
                    grant_type: 'refresh_token'
                }).toString(),
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            );

            const { access_token, expires_in } = tokenResponse.data;

            if (!access_token) {
                return reply.code(400).send({ error: 'Token 刷新失败，refresh_token 可能已失效' });
            }

            // 获取用户邮箱
            let email: string | undefined;
            try {
                const userInfo = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: {
                        'Authorization': `Bearer ${access_token}`
                    }
                });
                email = userInfo.data.email;
                console.log('[Upload Local] 获取到用户邮箱:', email);
            } catch (e) {
                console.warn('[Upload Local] 获取用户邮箱失败');
            }

            // 验证凭证权限
            console.log('[Upload Local] 开始验证凭证权限...');
            const testToken = {
                id: 0,
                access_token,
                refresh_token,
                expires_in: expires_in || 3599,
                timestamp: BigInt(Date.now()),
                project_id: null,
                session_id: generateSessionId()
            };
            const testMessages = [{ role: 'user', content: 'hi' }];
            const testModel = ANTIGRAVITY_MODELS[0] || 'gemini-3-pro-preview';

            try {
                const result = await AntigravityService.generateResponse(
                    testMessages,
                    testModel,
                    {},
                    undefined,
                    testToken as any,
                    { retry_on_429: true, max_retries: 3 }
                );
                console.log('[Upload Local] 验证测试返回, 响应内容:', JSON.stringify(result).substring(0, 200));

                if (!result.content && (!result.toolCalls || result.toolCalls.length === 0)) {
                    console.log('[Upload Local] 验证失败: 响应内容为空');
                    // 空响应验证不能跳过！
                    return reply.code(400).send({ error: '验证失败：API 返回空响应，该凭证无法正常使用。' });
                } else {
                    console.log('[Upload Local] 验证测试成功');
                }
            } catch (e: any) {
                const msg = e.message || '';
                console.log('[Upload Local] 验证测试失败:', msg);

                if (msg.includes('403') || (e.statusCode === 403)) {
                    return reply.code(400).send({ error: '权限验证失败 (403)：该凭证无法调用 Antigravity 渠道模型。' });
                }

                // 只有 Project ID 相关的错误可以通过勾选跳过
                const isProjectIdError = msg.toLowerCase().includes('project') || msg.includes('INVALID_ARGUMENT');

                if (!isProjectIdError || !skip_project_id) {
                    return reply.code(400).send({ error: '验证 Antigravity 权限失败: ' + msg });
                }

                console.warn(`[Upload Local] 用户 ${userId} 选择跳过 Project ID 认证, 错误: ${msg}`);
            }

            // 保存 Token
            const token = await antigravityTokenManager.addToken({
                access_token,
                refresh_token,
                expires_in,
                email,
                projectId: undefined,
                ownerId: userId
            });

            return { success: true, token: { id: token.id, email, projectId: token.project_id } };
        } catch (e: any) {
            console.error('[Upload Local] 上传失败:', e.response?.data || e.message);
            return reply.code(500).send({
                error: e.response?.data?.error_description || e.response?.data?.error || e.message
            });
        }
    });

    // 一键启用失效的 Antigravity Token (仅管理员)
    app.post('/tokens/enable-dead', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;
        const tokens = await prisma.antigravityToken.findMany({
            where: { status: 'DEAD' },
            select: { id: true, access_token: true, refresh_token: true, expires_in: true, timestamp: true, project_id: true, owner_id: true, email: true }
        });
        const results: any = { total: tokens.length, processed: 0, activated: 0, cooled: 0, still_dead: 0, errors: [] };
        for (const t of tokens) {
            results.processed++;
            const tokenData = {
                id: t.id,
                access_token: t.access_token,
                refresh_token: t.refresh_token,
                expires_in: t.expires_in,
                timestamp: t.timestamp,
                project_id: t.project_id,
                session_id: generateSessionId()
            };
            try {
                const result = await AntigravityService.generateResponse(
                    [{ role: 'user', content: 'hello' }],
                    ANTIGRAVITY_MODELS[0] || 'claude-sonnet-4-5',
                    { max_tokens: 8, temperature: 0.1 },
                    undefined,
                    tokenData as any,
                    { retry_on_429: true, max_retries: 3 }
                );
                if (result.content && result.content.length > 0) {
                    await prisma.antigravityToken.update({ where: { id: t.id }, data: { status: 'ACTIVE', is_enabled: true } });
                    results.activated++;
                    continue;
                }
                results.still_dead++;
                results.errors.push({ id: t.id, email: t.email, reason: 'empty_content' });
            } catch (e: any) {
                const status = e.statusCode;
                const msg = e.message || '';
                if (status === 403 || msg.includes('403')) {
                    results.still_dead++;
                    results.errors.push({ id: t.id, email: t.email, reason: '403' });
                    continue;
                }
                if (status === 429 || msg.includes('429')) {
                    await antigravityTokenManager.markAsCooling(t.id, 5 * 60 * 1000);
                    await prisma.antigravityToken.update({ where: { id: t.id }, data: { status: 'ACTIVE', is_enabled: true } });
                    results.cooled++;
                    continue;
                }
                results.errors.push({ id: t.id, email: t.email, reason: String(status || 'unknown'), message: msg });
                results.still_dead++;
            }
        }
        return results;
    });

    // 失效 Token 检活（仅管理员）
    app.post('/health-check/dead', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;
        const tokens = await prisma.antigravityToken.findMany({
            where: { status: 'DEAD' },
            select: { id: true, access_token: true, refresh_token: true, expires_in: true, timestamp: true, project_id: true, owner_id: true, email: true }
        });
        const results: any = { total: tokens.length, checked: 0, healthy: 0, dead: 0, cooled: 0, errors: [] };
        for (const t of tokens) {
            results.checked++;
            const tokenData = {
                id: t.id,
                access_token: t.access_token,
                refresh_token: t.refresh_token,
                expires_in: t.expires_in,
                timestamp: t.timestamp,
                project_id: t.project_id,
                session_id: generateSessionId()
            };
            try {
                const result = await AntigravityService.generateResponse(
                    [{ role: 'user', content: 'hello' }],
                    ANTIGRAVITY_MODELS[0] || 'claude-sonnet-4-5',
                    { max_tokens: 8, temperature: 0.1 },
                    undefined,
                    tokenData as any,
                    { retry_on_429: true, max_retries: 3 }
                );
                if (result.content && result.content.length > 0) {
                    results.healthy++;
                    continue;
                }
                results.errors.push({ id: t.id, email: t.email, error: 'empty_content' });
            } catch (e: any) {
                const status = e.statusCode;
                const msg = e.message || '';
                if (status === 403 || msg.includes('403')) {
                    results.dead++;
                    continue;
                }
                if (status === 429 || msg.includes('429')) {
                    results.cooled++;
                    continue;
                }
                results.errors.push({ id: t.id, email: t.email, error: String(status || 'unknown') });
            }
        }
        return results;
    });

    app.get('/my-tokens', async (req, reply) => {
        const userId = await verifyAuth(req, reply);
        if (userId === null) return;
        const query = req.query as any;
        const page = Math.max(1, parseInt(query.page) || 1);
        const limitRaw = parseInt(query.limit) || 10;
        const limit = Math.min(Math.max(1, limitRaw), 50);
        const skip = (page - 1) * limit;
        const [total, tokens] = await prisma.$transaction([
            prisma.antigravityToken.count({ where: { owner_id: userId } }),
            prisma.antigravityToken.findMany({
                where: { owner_id: userId },
                orderBy: { id: 'desc' },
                skip,
                take: limit
            })
        ]);
        const data = tokens.map(t => ({
            id: t.id,
            email: t.email,
            project_id: t.project_id,
            is_enabled: t.is_enabled,
            status: t.status,
            created_at: t.created_at
        }));
        return { tokens: data, total, page, limit };
    });

    app.delete('/my-tokens/:id', async (req, reply) => {
        const userId = await verifyAuth(req, reply);
        if (userId === null) return;
        const { id } = req.params as { id: string };
        const tokenId = parseInt(id);
        const token = await prisma.antigravityToken.findUnique({ where: { id: tokenId } });
        if (!token) {
            return reply.code(404).send({ error: 'Not found' });
        }
        if (token.owner_id !== userId) {
            return reply.code(403).send({ error: 'Forbidden' });
        }
        await antigravityTokenManager.deleteToken(tokenId);
        return { success: true };
    });

    app.put('/my-tokens/:id', async (req, reply) => {
        const userId = await verifyAuth(req, reply);
        if (userId === null) return;
        const { id } = req.params as { id: string };
        const body = req.body as any;
        const tokenId = parseInt(id);
        const token = await prisma.antigravityToken.findUnique({ where: { id: tokenId } });
        if (!token) {
            return reply.code(404).send({ error: 'Not found' });
        }
        if (token.owner_id !== userId) {
            return reply.code(403).send({ error: 'Forbidden' });
        }
        if (typeof body.is_enabled !== 'boolean') {
            return reply.code(400).send({ error: 'is_enabled is required and must be boolean' });
        }
        const updated = await antigravityTokenManager.updateToken(tokenId, { is_enabled: body.is_enabled });
        return { success: true, token: { id: updated.id, is_enabled: updated.is_enabled } };
    });

    // 刷新所有 Token (仅管理员)
    app.post('/refresh-all', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;

        const tokens = await antigravityTokenManager.getAllTokens();
        const results: any[] = [];

        for (const t of tokens) {
            if (t.is_enabled) {
                const success = await antigravityTokenManager.refreshToken(t.id);
                results.push({ id: t.id, success });
            }
        }

        return { results };
    });

    // 从 antigravity2api 项目导入本地 accounts.json (仅管理员)
    app.post('/import-accounts', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;

        const body = req.body as any;
        let ownerId = Number(body?.owner_id);
        if (!Number.isFinite(ownerId)) {
            const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
            if (!adminUser) {
                return reply.code(400).send({ error: '没有找到管理员用户，请在请求体提供 owner_id' });
            }
            ownerId = adminUser.id;
        }

        const accountsPath = path.join(process.cwd(), 'antigravity2api-nodejs-main', 'antigravity2api-nodejs-main', 'data', 'accounts.json');
        if (!fs.existsSync(accountsPath)) {
            return reply.code(404).send({ error: `未找到 accounts.json: ${accountsPath}` });
        }

        try {
            const raw = fs.readFileSync(accountsPath, 'utf-8');
            const accounts = JSON.parse(raw) as Array<{
                access_token: string;
                refresh_token: string;
                expires_in?: number;
                timestamp?: number;
                enable?: boolean;
            }>;

            const results: any[] = [];
            for (const acc of accounts) {
                if (acc.enable === false) continue;
                try {
                    let projectId: string | undefined;
                    try {
                        const projectRes = await axios.post(
                            'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist',
                            { metadata: { ideType: 'ANTIGRAVITY' } },
                            {
                                headers: {
                                    'Host': 'daily-cloudcode-pa.sandbox.googleapis.com',
                                    'Authorization': `Bearer ${acc.access_token}`,
                                    'Content-Type': 'application/json',
                                    'User-Agent': 'antigravity/1.11.9 windows/amd64'
                                }
                            }
                        );
                        projectId = projectRes.data?.cloudaicompanionProject;
                    } catch (e: any) {
                        const status = e.response?.status;
                        const message = e.response?.data?.error?.message || e.message;
                        if (status === 403) {
                            results.push({ refresh_token_suffix: acc.refresh_token.slice(-8), error: '403 无权限: ' + message });
                            continue;
                        } else {
                            results.push({ refresh_token_suffix: acc.refresh_token.slice(-8), warn: '无法获取 projectId，已按无项目ID入库' });
                        }
                    }
                    const token = await antigravityTokenManager.addToken({
                        access_token: acc.access_token,
                        refresh_token: acc.refresh_token,
                        expires_in: acc.expires_in ?? 3599,
                        projectId,
                        ownerId
                    });
                    results.push({ refresh_token_suffix: acc.refresh_token.slice(-8), id: token.id, status: 'imported' });
                } catch (e: any) {
                    results.push({ refresh_token_suffix: acc.refresh_token.slice(-8), error: e.message });
                }
            }

            return { success: true, imported: results.length, results };
        } catch (e: any) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // 反重力凭证检活 - 验证所有 ACTIVE Token
    app.post('/health-check', async (req, reply) => {
        if (!await verifyAdmin(req, reply)) return;

        console.log('[Antigravity] 开始反重力凭证检活...');

        const allTokens = await prisma.antigravityToken.findMany({
            where: { status: 'ACTIVE', is_enabled: true },
            include: { owner: { select: { id: true, username: true, level: true } } }
        });

        console.log(`[Antigravity] 共 ${allTokens.length} 个 ACTIVE Token 需要检查`);

        const results = {
            total: allTokens.length,
            checked: 0,
            healthy: 0,
            dead: 0,
            cooled: 0,
            errors: [] as { id: number; email: string | null; owner: string | null; error: string; action?: string }[]
        };

        for (const token of allTokens) {
            results.checked++;
            console.log(`[Antigravity] 检查 Token ${token.id} (${token.email || 'unknown'})...`);

            try {
                // 构造测试 Token 对象
                const testToken = {
                    id: token.id,
                    access_token: token.access_token,
                    refresh_token: token.refresh_token,
                    expires_in: token.expires_in,
                    timestamp: token.timestamp,
                    project_id: token.project_id,
                    session_id: generateSessionId()
                };

                const testMessages = [{ role: 'user', content: 'hi' }];
                const testModel = ANTIGRAVITY_MODELS[0] || 'gemini-3-pro-preview';

                // 尝试发送测试消息
                const result = await AntigravityService.generateResponse(
                    testMessages,
                    testModel,
                    {},
                    undefined,
                    testToken as any
                );

                // 检查响应是否有效
                if (!result.content && (!result.toolCalls || result.toolCalls.length === 0)) {
                    // 空响应不视为失效，仍然计为健康
                    console.log(`[Antigravity] Token ${token.id} 空响应，但不视为失效`);
                }

                // Token 健康
                results.healthy++;
                console.log(`[Antigravity] Token ${token.id} 验证通过`);

            } catch (e: any) {
                const msg = e.message || '';
                console.log(`[Antigravity] Token ${token.id} 验证异常:`, msg);

                // 403 错误标记为 DEAD
                if (msg.includes('403')) {
                    await prisma.antigravityToken.update({
                        where: { id: token.id },
                        data: { status: 'DEAD', is_enabled: false }
                    });

                    // 降低用户等级
                    if (token.owner && token.owner.level > 0) {
                        await prisma.user.update({
                            where: { id: token.owner.id },
                            data: { level: { decrement: 1 } }
                        });
                        console.log(`[Antigravity] 用户 ${token.owner.username} 等级降低`);
                    }

                    results.dead++;
                    results.errors.push({
                        id: token.id,
                        email: token.email,
                        owner: token.owner?.username || null,
                        error: '403 权限不足',
                        action: '已失效'
                    });
                } else if (msg.includes('429')) {
                    // 429 错误冷却 5 小时 (同时设置 COOLING 状态)
                    const cooldownTime = new Date(Date.now() + 5 * 60 * 60 * 1000);

                    await prisma.antigravityToken.update({
                        where: { id: token.id },
                        data: {
                            status: 'COOLING',
                            cooling_until: cooldownTime
                        }
                    });

                    results.cooled++;
                    results.errors.push({
                        id: token.id,
                        email: token.email,
                        owner: token.owner?.username || null,
                        error: '429 速率限制',
                        action: `冷却至 ${cooldownTime.toLocaleString('zh-CN')}`
                    });
                }
                // 其他错误不处理
            }
        }

        console.log(`[Antigravity] 检活完成: 健康 ${results.healthy}, 失效 ${results.dead}, 冷却 ${results.cooled}`);
        return results;
    });
}
