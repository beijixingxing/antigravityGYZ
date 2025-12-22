import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient, CredentialStatus } from '@prisma/client';
import Redis from 'ioredis';
import { stream } from 'undici';
import { CredentialPoolManager } from '../services/CredentialPoolManager';
import { PassThrough, Transform } from 'stream';
import { getUserAgent } from '../utils/system';
import { makeHttpError, isHttpError } from '../utils/http';
import { mergeSafetySettings, transformTools } from '../utils/gemini_transforms';
import { antigravityTokenManager } from '../services/AntigravityTokenManager';
import { AntigravityService } from '../services/AntigravityService';
import { isAntigravityModel, extractRealModelName, getAntigravityModelNames, ANTIGRAVITY_SUFFIX } from '../config/antigravityConfig';
import { mapModelName } from '../utils/antigravityUtils';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const poolManager = new CredentialPoolManager();

// 使用 UTC+8 时区计算今日日期字符串，与 today_used 重置时间一致
function getTodayStrUTC8(): string {
    const now = new Date();
    const utc8Offset = 8 * 60 * 60 * 1000;
    return new Date(now.getTime() + utc8Offset).toISOString().split('T')[0];
}

// --- Model Configuration (Ported from gcli2api/config.py) ---

const DEFAULT_SAFETY_SETTINGS = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
];

function getAvailableModels() {
    // Cloud Code 渠道模型
    const cloudCodeModels = [
        "gemini-2.5-flash-真流-[星星公益站-CLI渠道]",
        "gemini-2.5-flash-假流-[星星公益站-CLI渠道]",
        "gemini-2.5-pro-真流-[星星公益站-CLI渠道]",
        "gemini-2.5-pro-假流-[星星公益站-CLI渠道]",
        "gemini-3-pro-preview-真流-[星星公益站-CLI渠道]",
        "gemini-3-pro-preview-假流-[星星公益站-CLI渠道]",
        "gemini-3-flash-preview-真流-[星星公益站-CLI渠道]",
        "gemini-3-flash-preview-假流-[星星公益站-CLI渠道]"
    ];

    // 反重力渠道模型
    const antigravityModels = getAntigravityModelNames();

    return [...cloudCodeModels, ...antigravityModels];
}

export class ProxyController {
    private static modelsCache: { data: any[]; expiresAt: number } | null = null;

    static async handleChatCompletion(req: FastifyRequest, reply: FastifyReply) {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return reply.code(401).send({ error: 'Missing API Key' });
        }
        const apiKeyStr = authHeader.replace('Bearer ', '').trim();

        // 0. Fast Health Check (Before DB/Auth)
        // Intercept "Hi" messages immediately to speed up connection tests
        try {
            const body = req.body as any;
            const messages = body.messages || [];
            if (messages.length === 1 && messages[0].role === 'user' && messages[0].content === 'Hi') {
                return reply.send({
                    choices: [{ message: { role: 'assistant', content: 'Gemini Proxy 正常工作中' } }]
                });
            }
        } catch (e) { }

        // 1. Auth & Rate Limiting
        const apiKeyData = await prisma.apiKey.findUnique({
            where: { key: apiKeyStr },
            include: { user: true }
        });

        if (!apiKeyData || !apiKeyData.is_active) {
            return reply.code(401).send({ error: 'Invalid or disabled API Key' });
        }

        const user = apiKeyData.user;

        if (!user.is_active) {
            return reply.code(403).send({ error: '🚫 您的账户已被禁用，请联系管理员解封。' });
        }

        const isAdminKey = (apiKeyData as any).type === 'ADMIN';

        const forceBindSetting = await prisma.systemSetting.findUnique({ where: { key: 'FORCE_DISCORD_BIND' } });
        const forceDiscordBind = forceBindSetting ? forceBindSetting.value === 'true' : false;
        if (forceDiscordBind && !isAdminKey) {
            const userFull = await prisma.user.findUnique({ where: { id: user.id } }) as any;
            if (!userFull?.discordId) {
                return reply.code(403).send({ error: '请先绑定 Discord 账户后再使用服务' });
            }
        }

        // Fetch counts for permissions
        // 冷却的凭证仍然算入配额增量，只有 DEAD 的不算
        const activeCredCount = await prisma.googleCredential.count({
            where: { owner_id: user.id, status: { in: [CredentialStatus.ACTIVE, CredentialStatus.COOLING] } }
        });
        const activeV3CredCount = await prisma.googleCredential.count({
            where: { owner_id: user.id, status: { in: [CredentialStatus.ACTIVE, CredentialStatus.COOLING] }, supports_v3: true }
        });

        // 全局共享模式拦截已移除；分别在各渠道分支内进行访问控制

        if (!isAdminKey) {
            // Fetch System Config
            const configSetting = await prisma.systemSetting.findUnique({ where: { key: 'SYSTEM_CONFIG' } });
            let rateLimit = 10; // Default Newbie
            let baseQuota = 300; // Default Newbie Quota

            if (configSetting) {
                try {
                    const conf = JSON.parse(configSetting.value);
                    const limits = conf.rate_limit || {};

                    // Rate Limit Logic (Keep as is, based on level/V3)
                    if (activeV3CredCount > 0) rateLimit = limits.v3_contributor ?? 120;
                    else if (activeCredCount > 0) rateLimit = limits.contributor ?? 60;
                    else rateLimit = limits.newbie ?? 10;

                    const quotaConf = conf.quota || {};
                    if (activeV3CredCount > 0) {
                        baseQuota = quotaConf.v3_contributor ?? 3000;
                    } else if (activeCredCount > 0) {
                        baseQuota = quotaConf.contributor ?? 1500;
                    } else {
                        baseQuota = quotaConf.newbie ?? 300;
                    }
                } catch (e) { }
            }

            const systemSetting = await prisma.systemSetting.findUnique({ where: { key: 'SYSTEM_CONFIG' } });
            const conf = (() => {
                try { return JSON.parse(systemSetting?.value || '{}'); } catch { return {}; }
            })();
            const inc = (conf.quota?.increment_per_credential ?? 1000);
            const extra = Math.max(0, activeCredCount - 1) * inc;
            const totalQuota = baseQuota + extra;

            if (user.today_used >= totalQuota) {
                return reply.code(402).send({ error: `Daily quota exceeded (${user.today_used}/${totalQuota})` });
            }

            const rateKey = `RATE_LIMIT:${user.id}`;
            const currentRate = await redis.incr(rateKey);
            if (currentRate === 1) await redis.expire(rateKey, 60);
            if (currentRate > rateLimit) {
                return reply.code(429).send({ error: `Rate limit exceeded (${rateLimit}/min)` });
            }
        }

        // 2. Parse Request
        const openAIBody = req.body as any;
        if (!openAIBody.messages && typeof openAIBody.prompt === 'string') {
            openAIBody.messages = [{ role: 'user', content: String(openAIBody.prompt) }];
        }
        // Clamp temperature in incoming body to sane range for Antigravity path
        if (typeof openAIBody.temperature === 'number') {
            openAIBody.temperature = Math.min(1.0, Math.max(0.1, openAIBody.temperature));
        }
        const requestedModel = openAIBody.model;
        const isStreaming = openAIBody.stream === true;

        // 检查是否是反重力渠道模型
        if (isAntigravityModel(requestedModel)) {
            return ProxyController.handleAntigravityRequest(req, reply, openAIBody, user, isAdminKey);
        }

        // Model Mapping Logic (Cloud Code 渠道)
        let realModelName = requestedModel;
        let useFakeStream = false;

        if (requestedModel.includes('-[星星公益站-CLI渠道]') || requestedModel.includes('-[星星公益站-任何收费都是骗子]') || requestedModel.includes('-[星星公益站-所有收费都骗子]')) {
            // Remove suffix
            let base = requestedModel.replace('-[星星公益站-CLI渠道]', '').replace('-[星星公益站-任何收费都是骗子]', '').replace('-[星星公益站-所有收费都骗子]', '');

            // Check strategy
            if (base.includes('-假流')) {
                useFakeStream = true;
                realModelName = base.replace('-假流', '');
            } else if (base.includes('-真流')) {
                realModelName = base.replace('-真流', '');
            } else {
                realModelName = base;
            }
        }

        // V3 Logic
        const isV3Model = realModelName.includes('gemini-3') || realModelName.includes('gemini-exp');
        let poolType: 'GLOBAL' | 'V3' = 'GLOBAL';

        if (isV3Model) {
            // Check V3 Permissions
            const isAdmin = user.role === 'ADMIN';
            const hasV3Creds = activeV3CredCount > 0;
            // 新增开关：允许未上传或无3.0Pro权限也可使用3.0系列（CLI）
            const openAccessSetting = await prisma.systemSetting.findUnique({ where: { key: 'ENABLE_GEMINI3_OPEN_ACCESS' } });
            const enableOpenAccess = openAccessSetting ? openAccessSetting.value === 'true' : false;
            if (!enableOpenAccess) {
                if (!isAdmin && !hasV3Creds && !isAdminKey) {
                    return reply.code(403).send({
                        error: '🔒 此模型 (Gemini 3.0) 仅限管理员或上传了 3.0 凭证的用户使用。请先贡献 3.0 凭证！'
                    });
                }
            }
            poolType = 'V3';
        }

        // CLI 共享模式（仅 Cloud Code 渠道）
        const cliSharedSetting = await prisma.systemSetting.findUnique({ where: { key: 'ENABLE_CLI_SHARED_MODE' } });
        let isCliSharedMode = cliSharedSetting ? cliSharedSetting.value === 'true' : true;
        if (cliSharedSetting == null) {
            // 兼容旧键
            const legacy = await prisma.systemSetting.findUnique({ where: { key: 'ENABLE_SHARED_MODE' } });
            isCliSharedMode = legacy ? legacy.value === 'true' : true;
        }
        if (!isCliSharedMode && !isAdminKey) {
            const isAdmin = user.role === 'ADMIN';
            const hasCliCredential = activeCredCount > 0;
            if (!isAdmin && !hasCliCredential) {
                return reply.code(403).send({
                    error: '🔒 已关闭 CLI 共享模式：仅上传过 CLI 凭证的用户可以使用 Cloud Code 渠道。'
                });
            }
        }

        try {
            // 3. Transform Request 
            const modifiedBody = { ...openAIBody, model: realModelName };
            const geminiPayload = ProxyController.transformOpenAIToGemini(modifiedBody);

            // 4. Execute
            if (isStreaming) {
                if (useFakeStream) {
                    await ProxyController.handleFakeStreamRequest(req, reply, realModelName, geminiPayload, user, isAdminKey, poolType);
                } else {
                    await ProxyController.handleStreamRequest(req, reply, realModelName, geminiPayload, user, isAdminKey, poolType);
                }
            } else {
                await ProxyController.handleStandardRequest(req, reply, realModelName, geminiPayload, user, isAdminKey, poolType);
            }

        } catch (err: any) {
            console.error('[Proxy] Error:', err);
            const errPayload = { error: { message: err.message || 'Internal Server Error', type: 'server_error' } };
            if (!reply.raw.headersSent) {
                reply.code(500).send(errPayload);
            }
        }
    }

    static async handleListModels(req: FastifyRequest, reply: FastifyReply) {
        const now = Date.now();
        if (ProxyController.modelsCache && ProxyController.modelsCache.expiresAt > now) {
            return reply.send({ object: 'list', data: ProxyController.modelsCache.data });
        }
        const models = getAvailableModels();

        const data = models.map(id => ({
            id,
            object: 'model',
            created: Math.floor(Date.now() / 1000), // Dynamic created time
            owned_by: 'google',
            permission: [],
            root: id,
            parent: null,
        }));

        ProxyController.modelsCache = { data, expiresAt: now + 5 * 60 * 1000 };
        return reply.send({ object: 'list', data });
    }

    // --- Antigravity 渠道处理 ---

    private static async handleAntigravityRequest(
        req: FastifyRequest,
        reply: FastifyReply,
        openAIBody: any,
        user: any,
        isAdminKey: boolean
    ) {
        const requestedModel = openAIBody.model;
        const isStreaming = openAIBody.stream === true;

        const realModel = extractRealModelName(requestedModel);
        const actualModelId = mapModelName(realModel);
        const group = realModel.includes('gemini-3') ? 'gemini3' : 'claude';

        // Load Antigravity Config
        let claudeLimit = 100;
        let gemini3Limit = 200;
        let useTokenQuota = false;
        let claudeTokenQuota = 100000;
        let gemini3TokenQuota = 200000;
        let agRateLimit = 30; // 反重力渠道每分钟请求限制
        let config: any = {};

        try {
            const configSetting = await prisma.systemSetting.findUnique({ where: { key: 'ANTIGRAVITY_CONFIG' } });
            if (configSetting) {
                config = JSON.parse(configSetting.value);
                claudeLimit = config.claude_limit ?? 100;
                gemini3Limit = config.gemini3_limit ?? 200;
                useTokenQuota = !!config.use_token_quota;
                claudeTokenQuota = config.claude_token_quota ?? 100000;
                gemini3TokenQuota = config.gemini3_token_quota ?? 200000;
                agRateLimit = config.rate_limit ?? 30;
            }
        } catch (e) {
            console.error('Failed to load ANTIGRAVITY_CONFIG', e);
        }

        // 反重力渠道速率限制检查（每分钟请求数限制）
        // 动态计算速率限制：如果用户上传了凭证，使用 rate_limit_increment，否则使用 rate_limit
        let effectiveRateLimit = agRateLimit;
        if (!isAdminKey) {
            const hasAccess = await antigravityTokenManager.hasAntigravityAccess(user.id);
            if (hasAccess) {
                effectiveRateLimit = config.rate_limit_increment ?? agRateLimit;
            }
        }

        if (!isAdminKey && effectiveRateLimit > 0) {
            const now = Math.floor(Date.now() / 60000); // 当前分钟
            const rateKey = `AG_RATE:${user.id}:${now}`;
            const current = parseInt((await redis.get(rateKey)) || '0', 10);

            if (current >= effectiveRateLimit) {
                return reply.code(429).send({
                    error: {
                        message: `反重力渠道速率限制：每分钟最多 ${effectiveRateLimit} 次请求，请稍后再试`,
                        type: 'rate_limit_exceeded'
                    }
                });
            }

            // 增加计数并设置 2 分钟过期
            await redis.incr(rateKey);
            await redis.expire(rateKey, 120);
        }

        // Calculate Base Limit (Token or Request count)
        const base = useTokenQuota
            ? (group === 'gemini3' ? gemini3TokenQuota : claudeTokenQuota)
            : (group === 'gemini3' ? gemini3Limit : claudeLimit);

        // Calculate Increment based on User's Tokens (ACTIVE + COOLING)
        // 冷却的凭证仍然算入配额增量，只有 DEAD 的不算
        const userTokenCount = await prisma.antigravityToken.count({
            where: {
                owner_id: user.id,
                status: { in: ['ACTIVE', 'COOLING'] },
                is_enabled: true
            }
        });

        const inc = useTokenQuota
            ? (group === 'gemini3' ? config.increment_token_per_token_gemini3 : config.increment_token_per_token_claude)
            : (group === 'gemini3' ? config.increment_per_token_gemini3 : config.increment_per_token_claude);

        const computedLimit = base + (userTokenCount > 0 ? userTokenCount * (inc || 0) : 0);

        const todayStr = getTodayStrUTC8();

        // Dual Keys: Always maintain both counters
        const usageKeyRequests = `USAGE:requests:${todayStr}:${user.id}:antigravity:${group}`;
        const usageKeyTokens = `USAGE:tokens:${todayStr}:${user.id}:antigravity:${group}`;

        // Legacy Key (Fallback/Migration) - eventually we can deprecate this
        // But for now, let's just use the specific keys for logic

        const strictSetting = await prisma.systemSetting.findUnique({ where: { key: 'ANTIGRAVITY_STRICT_MODE' } });
        const strictMode = strictSetting ? strictSetting.value === 'true' : false;

        // 严格模式：只有上传过反重力凭证的用户才能使用反重力渠道
        if (!isAdminKey && user.role !== 'ADMIN' && strictMode) {
            const hasAccess = await antigravityTokenManager.hasAntigravityAccess(user.id);
            if (!hasAccess) {
                console.warn('[Antigravity] Strict mode enabled, user without valid credential blocked:', user.id);
                return reply.code(403).send({
                    error: {
                        message: '🔒 已开启反重力严格模式：仅上传过有效凭证的用户可以使用反重力渠道。',
                        type: 'forbidden'
                    }
                });
            }
        }

        // 配额检查（无论严格模式是否开启都检查）
        if (!isAdminKey) {
            const userOverride = group === 'gemini3' ? user.ag_gemini3_limit : user.ag_claude_limit;
            const effectiveLimit = (userOverride && userOverride > 0) ? userOverride : computedLimit;

            // Check limit based on current mode
            const current = parseInt((await redis.get(useTokenQuota ? usageKeyTokens : usageKeyRequests)) || '0', 10);

            if (current >= effectiveLimit) {
                const unit = useTokenQuota ? 'Tokens' : 'Requests';
                return reply.code(402).send({
                    error: { message: `Antigravity ${group} daily limit reached (${current}/${effectiveLimit} ${unit})`, type: 'quota_exceeded' }
                });
            }
        }

        // 获取 Antigravity Token (从公共池，按用户锁定避免跨用户并发共享)
        const initialTtl = isStreaming ? 60000 : 30000;
        const token = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3', modelId: actualModelId }, user.id, initialTtl);
        if (!token) {
            return reply.code(503).send({
                error: { message: '没有可用的反重力渠道 Token，请联系管理员添加', type: 'service_unavailable' }
            });
        }

        console.log(`[Antigravity] 处理请求: ${requestedModel} -> ${realModel}, streaming: ${isStreaming}`);

        const responseId = 'chatcmpl-' + crypto.randomUUID();
        const created = Math.floor(Date.now() / 1000);

        try {
            if (isStreaming) {
                // 流式响应
                reply.raw.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no'
                });

                let tokenUsed = false;
                let usageTokens = 0;

                // 立即计数请求次数（不等待 usage 事件）
                try {
                    await redis.incr(usageKeyRequests);
                    const now = new Date();
                    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
                    const seconds = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
                    await redis.expire(usageKeyRequests, seconds);
                    await redis.hincrby(`AG_GLOBAL:requests:${todayStr}`, group, 1);
                    await redis.expire(`AG_GLOBAL:requests:${todayStr}`, 86400);
                    console.log(`[Antigravity] 请求计数成功: ${usageKeyRequests}`);
                } catch (e) {
                    console.error('[Antigravity] 请求计数失败:', e);
                }

                let attempts = 0;
                let currentToken = token;
                const onData = async (data: any) => {
                        // 记录 Token 使用
                        if (!tokenUsed) {
                            await prisma.antigravityToken.update({
                                where: { id: currentToken.id },
                                data: { total_used: { increment: 1 }, last_used_at: new Date(), fail_count: 0 }
                            }).catch(() => { });
                            tokenUsed = true;
                        }
                        // 收集 Token 用量（请求次数已在流开始前计数）
                        if (data.type === 'usage') {
                            usageTokens = data.usage?.total_tokens || 0;
                        }

                        if (data.type === 'text') {
                            const chunk = {
                                id: responseId,
                                object: 'chat.completion.chunk',
                                created,
                                model: requestedModel,
                                choices: [{
                                    index: 0,
                                    delta: { content: data.content },
                                    finish_reason: null
                                }]
                            };
                            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
                        } else if (data.type === 'reasoning') {
                            // 思维内容 -> reasoning_content 字段（和 CLI 一致）
                            const chunk = {
                                id: responseId,
                                object: 'chat.completion.chunk',
                                created,
                                model: requestedModel,
                                choices: [{
                                    index: 0,
                                    delta: { reasoning_content: data.content },
                                    finish_reason: null
                                }]
                            };
                            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
                        } else if (data.type === 'tool_calls') {
                            const chunk = {
                                id: responseId,
                                object: 'chat.completion.chunk',
                                created,
                                model: requestedModel,
                                choices: [{
                                    index: 0,
                                    delta: { tool_calls: data.tool_calls },
                                    finish_reason: null
                                }]
                            };
                            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
                        } else if (data.type === 'usage') {
                            // 发送结束 chunk
                            const endChunk = {
                                id: responseId,
                                object: 'chat.completion.chunk',
                                created,
                                model: requestedModel,
                                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                                usage: data.usage
                            };
                            reply.raw.write(`data: ${JSON.stringify(endChunk)}\n\n`);
                        }
                };
                while (attempts < 5) {
                    try {
                        await AntigravityService.generateStreamResponse(
                            openAIBody.messages,
                            realModel,
                            openAIBody,
                            openAIBody.tools,
                            currentToken,
                            onData
                        );
                        break;
                    } catch (err: any) {
                        const status = err?.statusCode || err?.response?.status;
                        const msg = err?.body || err?.message || '';
                        if (status === 429 || /Resource has been exhausted/i.test(String(msg))) {
                            let cooldownMs = 60000;
                            try {
                                const obj = JSON.parse(String(msg));
                                const details = obj?.error?.details || [];
                                for (const d of details) {
                                    if (d['@type'] && String(d['@type']).includes('google.rpc.ErrorInfo')) {
                                        const ts = d?.metadata?.quotaResetTimeStamp;
                                        const retryDelay = d?.metadata?.retryDelay ? parseInt(d.metadata.retryDelay, 10) : 0;
                                        if (ts) {
                                            const ms = new Date(ts).getTime() - Date.now();
                                            if (ms > 0) cooldownMs = ms;
                                        } else if (retryDelay > 0) {
                                            cooldownMs = retryDelay * 1000;
                                        }
                                        break;
                                    }
                                }
                            } catch {}
                            try { await antigravityTokenManager.markAsCooling(currentToken.id, cooldownMs); } catch {}
                            await antigravityTokenManager.releaseLock(currentToken.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3' }, user.id, 60000);
                            if (!next) throw err;
                            currentToken = next;
                            attempts++;
                            continue;
                        } else if (status === 403) {
                            try { await antigravityTokenManager.markAsDead(currentToken.id); } catch {}
                            await antigravityTokenManager.releaseLock(currentToken.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3' }, user.id, 60000);
                            if (!next) throw err;
                            currentToken = next;
                            attempts++;
                            continue;
                        } else if (status === 500) {
                            await antigravityTokenManager.releaseLock(currentToken.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3' }, user.id, 60000);
                            if (!next) throw err;
                            currentToken = next;
                            attempts++;
                            continue;
                        }
                        throw err;
                    }
                }

                // 流结束后更新 Token 用量
                // 如果没有收到 usage 事件，使用保底估算值
                const finalTokens = usageTokens > 0 ? usageTokens : 1000;
                console.log(`[Antigravity] 流式请求结束, usageTokens=${usageTokens}, finalTokens=${finalTokens}`);
                try {
                    await redis.incrby(usageKeyTokens, finalTokens);
                    const now = new Date();
                    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
                    const seconds = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
                    await redis.expire(usageKeyTokens, seconds);
                    await redis.hincrby(`AG_GLOBAL:tokens:${todayStr}`, group, finalTokens);
                    await redis.expire(`AG_GLOBAL:tokens:${todayStr}`, 86400);
                } catch (e) {
                    console.error('[Antigravity] Token 计数失败:', e);
                }

                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
                try { await antigravityTokenManager.releaseLock(currentToken.id, user.id); } catch {}

            } else {
                // 非流式响应 - 立即计数请求次数
                try {
                    await redis.incr(usageKeyRequests);
                    const now = new Date();
                    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
                    const seconds = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
                    await redis.expire(usageKeyRequests, seconds);
                    await redis.hincrby(`AG_GLOBAL:requests:${todayStr}`, group, 1);
                    await redis.expire(`AG_GLOBAL:requests:${todayStr}`, 86400);
                    console.log(`[Antigravity] 非流式请求计数成功: ${usageKeyRequests}`);
                } catch (e) {
                    console.error('[Antigravity] 非流式请求计数失败:', e);
                }

                let attempts2 = 0;
                let currentToken2 = token;
                let gotResult = false, content = '', reasoningContent: string | undefined = undefined, toolCalls: any[] = [], usage: any = undefined;
                while (attempts2 < 5) {
                    try {
                        const res = await AntigravityService.generateResponse(
                            openAIBody.messages,
                            realModel,
                            openAIBody,
                            openAIBody.tools,
                            currentToken2,
                            { retry_on_429: true, max_retries: 5 }
                        );
                        content = res.content; reasoningContent = res.reasoningContent; toolCalls = res.toolCalls || []; usage = res.usage; gotResult = true;
                        break;
                    } catch (err: any) {
                        const status = err?.statusCode || err?.response?.status;
                        const msg = err?.body || err?.message || '';
                        if (status === 429 || /Resource has been exhausted/i.test(String(msg))) {
                            let cooldownMs = 60000;
                            try {
                                const obj = JSON.parse(String(msg));
                                const details = obj?.error?.details || [];
                                for (const d of details) {
                                    if (d['@type'] && String(d['@type']).includes('google.rpc.ErrorInfo')) {
                                        const ts = d?.metadata?.quotaResetTimeStamp;
                                        const retryDelay = d?.metadata?.retryDelay ? parseInt(d.metadata.retryDelay, 10) : 0;
                                        if (ts) {
                                            const ms = new Date(ts).getTime() - Date.now();
                                            if (ms > 0) cooldownMs = ms;
                                        } else if (retryDelay > 0) {
                                            cooldownMs = retryDelay * 1000;
                                        }
                                        break;
                                    }
                                }
                            } catch {}
                            try { await antigravityTokenManager.markAsCooling(currentToken2.id, cooldownMs); } catch {}
                            await antigravityTokenManager.releaseLock(currentToken2.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3' }, user.id, 30000);
                            if (!next) throw err;
                            currentToken2 = next;
                            attempts2++;
                            continue;
                        } else if (status === 403) {
                            try { await antigravityTokenManager.markAsDead(currentToken2.id); } catch {}
                            await antigravityTokenManager.releaseLock(currentToken2.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3' }, user.id, 30000);
                            if (!next) throw err;
                            currentToken2 = next;
                            attempts2++;
                            continue;
                        } else if (status === 500) {
                            await antigravityTokenManager.releaseLock(currentToken2.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3' }, user.id, 30000);
                            if (!next) throw err;
                            currentToken2 = next;
                            attempts2++;
                            continue;
                        }
                        throw err;
                    }
                }

                if (!gotResult) { throw makeHttpError(500, 'Failed to generate response after retries'); }

                // 记录 Token 使用
                await prisma.antigravityToken.update({
                    where: { id: token.id },
                    data: { total_used: { increment: 1 }, last_used_at: new Date(), fail_count: 0 }
                }).catch(() => { });

                // 更新 Token 用量（使用保底值如果没有 usage）
                const usageTokens = usage?.total_tokens || 1000;
                try {
                    await redis.incrby(usageKeyTokens, usageTokens);
                    const now = new Date();
                    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
                    const seconds = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
                    await redis.expire(usageKeyTokens, seconds);
                    await redis.hincrby(`AG_GLOBAL:tokens:${todayStr}`, group, usageTokens);
                    await redis.expire(`AG_GLOBAL:tokens:${todayStr}`, 86400);
                } catch { }

                const message: any = { role: 'assistant', content };
                if (reasoningContent) {
                    message.reasoning_content = reasoningContent;
                }
                if (toolCalls.length > 0) {
                    message.tool_calls = toolCalls;
                }

                const responseObj = {
                    id: responseId,
                    object: 'chat.completion',
                    created,
                    model: requestedModel,
                    choices: [{
                        index: 0,
                        message,
                        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
                    }],
                    usage
                };
                try { await antigravityTokenManager.releaseLock(currentToken2.id, user.id); } catch {}
                return reply.send(responseObj);
            }

        } catch (error: any) {
            console.error('[Antigravity] 请求失败:', error.message);

            // 处理 429 错误
            if (isHttpError(error) && error.statusCode === 429) {
                const currentToken = await prisma.antigravityToken.findUnique({ where: { id: token.id } });
                const newFailCount = (currentToken?.fail_count || 0) + 1;

                if (newFailCount >= 3) {
                    // 连续 3 次 429，进入长期冷却 (3小时)
                    await antigravityTokenManager.markAsCooling(token.id, 3 * 60 * 60 * 1000);
                    // 重置计数
                    await prisma.antigravityToken.update({
                        where: { id: token.id },
                        data: { fail_count: 0 }
                    });
                    console.log(`[Antigravity] Token #${token.id} 连续 3 次 429，进入冷却 3 小时`);
                } else {
                    // 单次 429，立即进入短期冷却 (5分钟)
                    await antigravityTokenManager.markAsCooling(token.id, 5 * 60 * 1000);
                    // 增加计数
                    await prisma.antigravityToken.update({
                        where: { id: token.id },
                        data: { fail_count: newFailCount }
                    });
                    console.log(`[Antigravity] Token #${token.id} 429 次数: ${newFailCount}/3，短期冷却 5 分钟`);
                }
            }
            if (isHttpError(error) && error.statusCode === 403) {
                await antigravityTokenManager.markAsDead(token.id);
            }

            const status = isHttpError(error) ? error.statusCode : 500;
            const type = status === 403 ? 'permission_denied' : (status === 404 ? 'not_found' : 'api_error');
            let outMsg = isHttpError(error) ? (error.body || error.message) : (error.message || 'Antigravity request failed');
            try {
                const parsed = JSON.parse(outMsg);
                outMsg = parsed?.error?.message || outMsg;
            } catch { }

            if (!reply.raw.headersSent) {
                return reply.code(status).send({
                    error: { message: outMsg, type, code: status }
                });
            } else {
                const errChunk = {
                    id: responseId,
                    object: 'chat.completion.chunk',
                    created,
                    model: requestedModel,
                    choices: [{
                        index: 0,
                        delta: { content: `\n\n[${type}: ${outMsg}]` },
                        finish_reason: 'stop'
                    }]
                };
                reply.raw.write(`data: ${JSON.stringify(errChunk)}\n\n`);
                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
            }
            try {
                if (isStreaming) {
                    // currentToken may be rotated; ensure last lock released
                    // no-op if not held by this user
                    await antigravityTokenManager.releaseLock((token as any).id, user.id);
                } else {
                    await antigravityTokenManager.releaseLock((token as any).id, user.id);
                }
            } catch {}
        }
    }

    // --- Transformation Logic (Ported from openai_transfer.py) ---

    private static transformOpenAIToGemini(openaiRequest: any) {
        const contents: any[] = [];
        let systemInstructions: string[] = [];
        let tools: any[] = [];

        // 1. Messages Processing
        for (const msg of openaiRequest.messages) {
            if (msg.role === 'system') {
                systemInstructions.push(msg.content);
            } else if (msg.role === 'tool') {
                // Convert tool response
                contents.push({
                    role: 'user',
                    parts: [{
                        functionResponse: {
                            name: msg.name, // OpenAI requires name for tool role
                            response: typeof msg.content === 'string' ? { result: msg.content } : msg.content
                        }
                    }]
                });
            } else if (msg.role === 'user' || msg.role === 'assistant') {
                const role = msg.role === 'assistant' ? 'model' : 'user';
                const parts: any[] = [];

                // Handle Content
                if (msg.content) {
                    if (Array.isArray(msg.content)) {
                        for (const part of msg.content) {
                            if (part.type === 'text') parts.push({ text: part.text });
                            else if (part.type === 'image_url') {
                                const url = part.image_url.url;
                                if (url.startsWith('data:')) {
                                    const [meta, data] = url.split(',');
                                    const mimeType = meta.split(':')[1].split(';')[0];
                                    parts.push({ inlineData: { mimeType, data } });
                                }
                            }
                        }
                    } else {
                        parts.push({ text: msg.content });
                    }
                }

                // Handle Tool Calls (Assistant only)
                if (msg.tool_calls) {
                    for (const toolCall of msg.tool_calls) {
                        parts.push({
                            functionCall: {
                                name: toolCall.function.name,
                                args: typeof toolCall.function.arguments === 'string'
                                    ? JSON.parse(toolCall.function.arguments)
                                    : toolCall.function.arguments
                            }
                        });
                    }
                }

                if (parts.length > 0) {
                    contents.push({ role, parts });
                }
            }
        }

        // Default message if empty (Gemini requirement)
        if (contents.length === 0) {
            contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
        }

        // 2. Generation Config
        const generationConfig: any = {
            topK: 64 // Default from gcli2api
        };
        if (openaiRequest.temperature != null) generationConfig.temperature = openaiRequest.temperature;
        if (openaiRequest.top_p != null) generationConfig.topP = openaiRequest.top_p;
        if (openaiRequest.max_tokens != null) generationConfig.maxOutputTokens = openaiRequest.max_tokens;
        if (openaiRequest.stop != null) generationConfig.stopSequences = Array.isArray(openaiRequest.stop) ? openaiRequest.stop : [openaiRequest.stop];

        // JSON Mode
        if (openaiRequest.response_format && openaiRequest.response_format.type === 'json_object') {
            generationConfig.responseMimeType = "application/json";
        }

        // Thinking (Heuristic based on model name or explicit config)
        if (openaiRequest.model.includes('thinking')) {
            generationConfig.thinkingConfig = {
                includeThoughts: true,
                thinkingBudget: 1024
            };
        }

        // 3. Tools Definition
        if (openaiRequest.tools) {
            const transformedTools = transformTools(openaiRequest.tools);
            if (transformedTools.length > 0) {
                tools = transformedTools;
            }
        }

        // Google Search Tool
        if (openaiRequest.model.includes('search')) {
            // Only add if not already present (check structure)
            const hasSearch = tools.some(t => t.googleSearch);
            if (!hasSearch) {
                tools.push({ googleSearch: {} });
            }
        }

        // 4. Construct Payload
        const payload: any = {
            contents,
            generationConfig,
            safetySettings: mergeSafetySettings(openaiRequest.safety_settings || openaiRequest.safetySettings || [])
        };

        if (systemInstructions.length > 0) {
            payload.systemInstruction = { parts: [{ text: systemInstructions.join('\n\n') }] };
        }

        if (tools.length > 0) {
            payload.tools = tools;
        }

        // Tool Config (tool_choice)
        if (openaiRequest.tool_choice) {
            if (openaiRequest.tool_choice === 'auto') payload.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
            else if (openaiRequest.tool_choice === 'none') payload.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
            else if (openaiRequest.tool_choice === 'required') payload.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
            else if (typeof openaiRequest.tool_choice === 'object') {
                payload.toolConfig = {
                    functionCallingConfig: {
                        mode: 'ANY',
                        allowedFunctionNames: [openaiRequest.tool_choice.function.name]
                    }
                };
            }
        }

        return payload;
    }

    // --- Response Conversion Logic ---

    private static convertGeminiResponseToOpenAI(geminiResponse: any, model: string, usageMetadata?: any) {
        const choices = (geminiResponse.candidates || []).map((candidate: any) => {
            const parts = candidate.content?.parts || [];
            let content = '';
            let reasoning_content = '';
            const toolCalls: any[] = [];

            for (const part of parts) {
                if (part.functionCall) {
                    toolCalls.push({
                        id: 'call_' + crypto.randomUUID(),
                        type: 'function',
                        function: {
                            name: part.functionCall.name,
                            arguments: JSON.stringify(part.functionCall.args)
                        }
                    });
                } else if (part.text) {
                    if (part.thought) reasoning_content += part.text;
                    else content += part.text;
                }
            }

            const message: any = { role: 'assistant' };
            if (content) message.content = content;
            if (reasoning_content) message.reasoning_content = reasoning_content;
            if (toolCalls.length > 0) message.tool_calls = toolCalls;

            return {
                index: candidate.index || 0,
                message,
                finish_reason: candidate.finishReason === 'STOP' ? 'stop' : 'length'
            };
        });

        let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        if (usageMetadata) {
            usage = {
                prompt_tokens: usageMetadata.promptTokenCount || 0,
                completion_tokens: usageMetadata.candidatesTokenCount || 0,
                total_tokens: usageMetadata.totalTokenCount || 0
            };
        }

        return {
            id: 'chatcmpl-' + crypto.randomUUID(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices,
            usage
        };
    }

    private static convertGeminiChunkToOpenAI(geminiChunk: any, model: string, id: string, usageMetadata?: any) {
        const choices: any[] = [];
        const candidates = geminiChunk.candidates || [];

        for (const candidate of candidates) {
            const parts = candidate.content?.parts || [];
            let finishReason = null;

            if (candidate.finishReason === 'STOP') finishReason = 'stop';
            else if (candidate.finishReason === 'MAX_TOKENS') finishReason = 'length';
            else if (candidate.finishReason) finishReason = 'stop';

            // Extract text, reasoning, tools
            let content = '';
            let reasoning = '';
            const toolCalls: any[] = [];

            for (const part of parts) {
                if (part.functionCall) {
                    toolCalls.push({
                        index: 0,
                        id: 'call_' + crypto.randomUUID(), // Stream tool calls usually need distinct IDs
                        type: 'function',
                        function: {
                            name: part.functionCall.name,
                            arguments: JSON.stringify(part.functionCall.args)
                        }
                    });
                } else if (part.text) {
                    if (part.thought) reasoning += part.text;
                    else content += part.text;
                }
            }

            const delta: any = {};
            if (content) delta.content = content;
            if (reasoning) delta.reasoning_content = reasoning;
            if (toolCalls.length > 0) delta.tool_calls = toolCalls;

            choices.push({
                index: candidate.index || 0,
                delta,
                finish_reason: finishReason
            });
        }

        const chunk: any = {
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices
        };

        if (usageMetadata) {
            chunk.usage = {
                prompt_tokens: usageMetadata.promptTokenCount || 0,
                completion_tokens: usageMetadata.candidatesTokenCount || 0,
                total_tokens: usageMetadata.totalTokenCount || 0
            };
        }

        return chunk;
    }

    // --- Helper: Parse Quota Reset Timestamp (Ported from utils.py) ---
    private static parseQuotaResetTimestamp(errorResponse: any): number | null {
        try {
            const error = errorResponse.error || {};
            const details = error.details || [];

            for (const detail of details) {
                if (detail['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo') {
                    const metadata = detail.metadata || {};
                    let resetTimestampStr = metadata.quotaResetTimeStamp;

                    if (resetTimestampStr) {
                        if (resetTimestampStr.endsWith('Z')) {
                            resetTimestampStr = resetTimestampStr.replace('Z', '+00:00');
                        }
                        const resetDate = new Date(resetTimestampStr);
                        return resetDate.getTime();
                    }
                } else if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo') {
                    const retryDelayStr = detail.retryDelay;
                    if (retryDelayStr && retryDelayStr.endsWith('s')) {
                        const delaySeconds = parseFloat(retryDelayStr.slice(0, -1));
                        if (!isNaN(delaySeconds)) {
                            return Date.now() + (delaySeconds * 1000);
                        }
                    }
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    private static createErrorResponse(message: string, statusCode: number = 500): any {
        return { error: { message, type: 'api_error', code: statusCode } };
    }

    private static async recordSuccessfulCall(credentialId: number, modelName: string, userId: number) {
        let key = 'other';
        let globalKey = 'other';

        if (modelName.includes('gemini-2.5-flash')) {
            key = 'gemini-2.5-flash';
            globalKey = 'flash';
        } else if (modelName.includes('gemini-2.5-pro')) {
            key = 'gemini-2.5-pro';
            globalKey = 'pro';
        } else if (modelName.includes('gemini-3-pro-preview') || modelName.includes('gemini-3')) {
            key = 'gemini-3-pro-preview';
            globalKey = 'v3';
        }

        const todayStr = getTodayStrUTC8();
        const userStatsKey = `USER_STATS:${userId}:${todayStr}`;
        const globalStatsKey = `GLOBAL_STATS:${todayStr}`;

        try {
            // User Stats (Detailed keys)
            await redis.hincrby(userStatsKey, key, 1);
            await redis.expire(userStatsKey, 172800); // 2 days

            // Global Stats (Simplified keys for Admin Dashboard)
            if (globalKey !== 'other') {
                await redis.hincrby(globalStatsKey, globalKey, 1);
                await redis.expire(globalStatsKey, 172800);
            }
        } catch (e) { }
    }

    // --- Core Request Execution (Ported from google_chat_api.py: send_gemini_request) ---
    private static async sendGeminiRequest(
        modelName: string,
        payload: any,
        isStreaming: boolean,
        credentialId: number,
        accessToken: string,
        projectId: string,
        onStreamChunk?: (chunkStr: string) => Promise<void>
    ): Promise<any> {
        const MAX_RETRIES = 5; // From gcli2api config
        const RETRY_INTERVAL = 1000; // 1 second, from gcli2api config

        const baseUrl = process.env.GOOGLE_CLOUD_CODE_URL || 'https://cloudcode-pa.googleapis.com';
        const action = isStreaming ? 'streamGenerateContent' : 'generateContent';
        let endpoint = `${baseUrl}/v1internal:${action}`;
        if (isStreaming) {
            endpoint += '?alt=sse';
        }

        const finalPayload = {
            model: modelName,
            project: projectId,
            request: payload
        };

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': getUserAgent()
        };

        for (let attempt = 0; attempt < MAX_RETRIES + 1; attempt++) {
            try {
                if (isStreaming) {
                    return await new Promise<void>((resolve, reject) => {
                        const bufferLine = { val: '' };

                        const transformer = new Transform({
                            writableObjectMode: true,
                            transform(chunk, encoding, callback) {
                                bufferLine.val += chunk.toString();
                                const lines = bufferLine.val.split('\n');
                                bufferLine.val = lines.pop() || '';
                                (async () => {
                                    for (const line of lines) {
                                        if (line.trim()) await onStreamChunk!(line);
                                    }
                                    callback();
                                })();
                            },
                            flush(callback) {
                                if (bufferLine.val.trim()) {
                                    (async () => {
                                        await onStreamChunk!(bufferLine.val);
                                        callback();
                                    })();
                                } else {
                                    callback();
                                }
                            }
                        });

                        stream(endpoint, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(finalPayload),
                            opaque: { reject, credentialId }
                        }, ({ statusCode, opaque }: any) => {
                            const { reject, credentialId } = opaque;

                            if (statusCode !== 200) {
                                let errBody = '';
                                const errStream = new PassThrough();
                                errStream.setEncoding('utf8');
                                errStream.on('data', c => errBody += c);
                                errStream.on('end', async () => {
                                    if (statusCode === 429) {
                                        try {
                                            const errJson = JSON.parse(errBody);
                                            const cooldown = ProxyController.parseQuotaResetTimestamp(errJson);
                                            if (cooldown !== null) {
                                                await poolManager.markAsCooling(credentialId, cooldown);
                                            } else {
                                                await poolManager.markAsCooling(credentialId);
                                            }
                                        } catch (e) {
                                            await poolManager.markAsCooling(credentialId);
                                        }
                                    } else if (statusCode === 403) {
                                        await poolManager.markAsDead(credentialId);
                                    }
                                    reject(makeHttpError(statusCode, errBody));
                                });
                                return errStream;
                            }

                            return transformer;
                        }).then(() => resolve()).catch(reject);
                    });
                } else {
                    const { request } = require('undici');
                    const { statusCode, body } = await request(endpoint, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(finalPayload)
                    });

                    if (statusCode !== 200) {
                        const errText = await body.text();
                        if (statusCode === 429) {
                            try {
                                const errJson = JSON.parse(errText);
                                const cooldown = ProxyController.parseQuotaResetTimestamp(errJson);
                                if (cooldown !== null) {
                                    await poolManager.markAsCooling(credentialId, cooldown);
                                } else {
                                    await poolManager.markAsCooling(credentialId);
                                }
                            } catch (e) {
                                await poolManager.markAsCooling(credentialId);
                            }
                        } else if (statusCode === 403) {
                            await poolManager.markAsDead(credentialId);
                        }
                        throw makeHttpError(statusCode, errText);
                    }

                    const rawData = await body.json() as any;
                    // Google API returns { response: { ... }, usageMetadata: { ... } }
                    // We need to merge them or just return the whole thing and handle extraction later.
                    // Let's return the whole thing to be safe and consistent with streaming logic potentially.
                    return rawData;
                }
            } catch (e: any) {
                console.warn(`[Proxy] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${e.message}`);
                if (attempt < MAX_RETRIES) {
                    await new Promise(r => setTimeout(r, RETRY_INTERVAL));
                } else {
                    throw e; // Max retries reached
                }
            }
        }
        throw new Error('Max retries exceeded and failed to get a response.');
    }

    // --- Strategy Handlers (Ported from openai_router.py) ---
    private static async handleStandardRequest(req: FastifyRequest, reply: FastifyReply, modelName: string, geminiPayload: any, user: any, isAdminKey: boolean, poolType: 'GLOBAL' | 'V3' = 'GLOBAL') {
        const MAX_429_RETRIES = 3;

        // 立即计数（不等待 API 响应）
        if (!isAdminKey) {
            await prisma.user.update({ where: { id: user.id }, data: { today_used: { increment: 1 } } }).catch(() => { });
        }
        let lastErr: any = null;
        for (let attempt = 0; attempt < MAX_429_RETRIES; attempt++) {
            const cred = await poolManager.getRoundRobinCredential(poolType);
            if (!cred) {
                return reply.code(500).send(ProxyController.createErrorResponse('No valid credentials available', 500));
            }
            try {
                const googleResponse = await ProxyController.sendGeminiRequest(
                    modelName, geminiPayload, false, cred.credentialId, cred.accessToken, cred.projectId
                );
                const geminiResponse = googleResponse.response || googleResponse;
                const usageMetadata = googleResponse.usageMetadata;
                const openaiResponse = ProxyController.convertGeminiResponseToOpenAI(geminiResponse, modelName, usageMetadata);
                await ProxyController.recordSuccessfulCall(cred.credentialId, modelName, user.id);
                return reply.send(openaiResponse);
            } catch (error: any) {
                if (isHttpError(error) && error.statusCode === 429) {
                    lastErr = error;
                    continue;
                }
                console.error('[Proxy] Standard request error:', error);
                return reply.code(500).send(ProxyController.createErrorResponse(error.message, 500));
            }
        }
        if (lastErr) {
            return reply.code(429).send(ProxyController.createErrorResponse(lastErr.body || lastErr.message, 429));
        }
    }

    private static async handleStreamRequest(req: FastifyRequest, reply: FastifyReply, modelName: string, geminiPayload: any, user: any, isAdminKey: boolean, poolType: 'GLOBAL' | 'V3' = 'GLOBAL') {
        const MAX_429_RETRIES = 3;

        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        const responseId = 'chatcmpl-' + crypto.randomUUID();

        // 立即计数（不等待首个 chunk）
        if (!isAdminKey) {
            await prisma.user.update({ where: { id: user.id }, data: { today_used: { increment: 1 } } }).catch(() => { });
        }
        let lastErr: any = null;
        for (let attempt = 0; attempt < MAX_429_RETRIES; attempt++) {
            const cred = await poolManager.getRoundRobinCredential(poolType);
            if (!cred) {
                reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
                reply.raw.end(JSON.stringify(ProxyController.createErrorResponse('No valid credentials available', 500)));
                return;
            }
            try {
                await ProxyController.sendGeminiRequest(
                    modelName, geminiPayload, true, cred.credentialId, cred.accessToken, cred.projectId,
                    async (chunkStr) => {
                        if (chunkStr.startsWith('data: ')) {
                            const jsonStr = chunkStr.substring(6);
                            try {
                                const geminiChunk = JSON.parse(jsonStr);
                                const data = geminiChunk.response || geminiChunk;
                                const usageMetadata = geminiChunk.usageMetadata;
                                const openaiChunk = ProxyController.convertGeminiChunkToOpenAI(data, modelName, responseId, usageMetadata);
                                reply.raw.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                            } catch (e) {
                                console.error('Error parsing/converting stream chunk:', e);
                            }
                        }
                    }
                );
                await ProxyController.recordSuccessfulCall(cred.credentialId, modelName, user.id);
                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
                return;
            } catch (error: any) {
                if (isHttpError(error) && error.statusCode === 429) {
                    lastErr = error;
                    continue;
                }
                console.error('[Proxy] Stream request error:', error);
                const errPayload = ProxyController.createErrorResponse(error.message, 500);
                reply.raw.write(`data: ${JSON.stringify(errPayload)}\n\n`);
                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
                return;
            }
        }
        if (lastErr) {
            const errPayload = ProxyController.createErrorResponse(lastErr.body || lastErr.message, 429);
            reply.raw.write(`data: ${JSON.stringify(errPayload)}\n\n`);
        }
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
    }

    private static async handleFakeStreamRequest(req: FastifyRequest, reply: FastifyReply, modelName: string, geminiPayload: any, user: any, isAdminKey: boolean, poolType: 'GLOBAL' | 'V3' = 'GLOBAL') {
        const MAX_429_RETRIES = 3;

        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        const responseId = 'chatcmpl-' + crypto.randomUUID();
        const created = Math.floor(Date.now() / 1000);

        // Heartbeat: Keep connection alive while waiting for generation
        const heartbeatInterval = setInterval(() => {
            const heartbeat = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model: modelName,
                choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
            };
            reply.raw.write(`data: ${JSON.stringify(heartbeat)}\n\n`);
        }, 2000); // Slower heartbeat to reduce noise

        if (!isAdminKey) {
            await prisma.user.update({ where: { id: user.id }, data: { today_used: { increment: 1 } } }).catch(() => { });
        }
        let lastErr: any = null;
        for (let attempt = 0; attempt < MAX_429_RETRIES; attempt++) {
            const cred = await poolManager.getRoundRobinCredential(poolType);
            if (!cred) {
                reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
                reply.raw.end(JSON.stringify(ProxyController.createErrorResponse('No valid credentials available', 500)));
                clearInterval(heartbeatInterval);
                return;
            }
            try {
                const geminiResponse = await ProxyController.sendGeminiRequest(
                    modelName, geminiPayload, false, cred.credentialId, cred.accessToken, cred.projectId
                );
                clearInterval(heartbeatInterval);
                await ProxyController.recordSuccessfulCall(cred.credentialId, modelName, user.id);

            // Extract content (Fix: Handle .response wrapper and Safety)
            const data = geminiResponse.response || geminiResponse;
            const candidates = data.candidates || [];
            const candidate = candidates[0] || {};
            const parts = candidate.content?.parts || [];

            let content = '';
            let reasoning = '';

            for (const part of parts) {
                if (part.text) {
                    if (part.thought) reasoning += part.text;
                    else content += part.text;
                }
            }

            if (!content && !reasoning) {
                content = '';
                if (candidate.finishReason === 'SAFETY') {
                    content = '🚫 [该回复因安全策略被拦截 / Content blocked by safety filters]';
                } else if (candidate.finishReason === 'RECITATION') {
                    content = '🚫 [该回复因版权/引用原因被拦截 / Content blocked by recitation check]';
                } else if (!reasoning) {
                    content = '[No text content returned from model. Raw status: ' + (candidate.finishReason || 'UNKNOWN') + ']';
                }
            }

            // Helper: Send full content at once
            const sendFullChunk = (text: string, isReasoning: boolean) => {
                if (!text) return;

                const delta: any = {};
                if (isReasoning) delta.reasoning_content = text;
                else delta.content = text;

                const chunk = {
                    id: responseId, object: "chat.completion.chunk", created, model: modelName,
                    choices: [{ index: 0, delta, finish_reason: null }]
                };
                reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
            };

            // 1. Send Reasoning (if any)
            if (reasoning) {
                sendFullChunk(reasoning, true);
            }

            // 2. Send Content (if any)
            if (content) {
                sendFullChunk(content, false);
            }

            // End chunk
            const usageMetadata = geminiResponse.usageMetadata;
            let usage = undefined;
            if (usageMetadata) {
                usage = {
                    prompt_tokens: usageMetadata.promptTokenCount || 0,
                    completion_tokens: usageMetadata.candidatesTokenCount || 0,
                    total_tokens: usageMetadata.totalTokenCount || 0
                };
            }

            const endChunk: any = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model: modelName,
                choices: [{ index: 0, delta: {}, finish_reason: candidate.finishReason === 'STOP' ? 'stop' : 'length' }]
            };
            if (usage) endChunk.usage = usage;

            reply.raw.write(`data: ${JSON.stringify(endChunk)}\n\n`);

                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
                return;
            } catch (error: any) {
                if (isHttpError(error) && error.statusCode === 429) {
                    lastErr = error;
                    continue;
                }
                clearInterval(heartbeatInterval);
                console.error('[Proxy] Fake stream request error:', error);
                const errPayload = ProxyController.createErrorResponse(error.message, 500);
                reply.raw.write(`data: ${JSON.stringify(errPayload)}\n\n`);
                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
                return;
            }
        }
        clearInterval(heartbeatInterval);
        if (lastErr) {
            const errPayload = ProxyController.createErrorResponse(lastErr.body || lastErr.message, 429);
            reply.raw.write(`data: ${JSON.stringify(errPayload)}\n\n`);
        }
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
    }

    private static async handleAntiTruncationStream(req: FastifyRequest, reply: FastifyReply, modelName: string, geminiPayload: any, user: any, isAdminKey: boolean, poolType: 'GLOBAL' | 'V3' = 'GLOBAL') {
        // Ported from gcli2api/anti_truncation.py#apply_anti_truncation_to_stream
        // This is complex and involves recursive calls to sendGeminiRequest for "Continue" prompts.
        // For now, it will be a simplified pass-through to sendGeminiRequest with streaming.
        // Full anti-truncation logic will require more complex state management and message history.
        console.warn("Anti-truncation stream is not fully implemented yet, falling back to standard streaming.");
        await ProxyController.handleStreamRequest(req, reply, modelName, geminiPayload, user, isAdminKey, poolType);
    }
}
