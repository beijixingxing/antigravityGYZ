import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient, CredentialStatus } from '@prisma/client';
import { stream, request as undiciRequest } from 'undici';
import { CredentialPoolManager } from '../services/CredentialPoolManager';
import { PassThrough, Transform } from 'stream';
import { getUserAgent } from '../utils/system';
import { makeHttpError, isHttpError } from '../utils/http';
import { mergeSafetySettings, transformTools } from '../utils/gemini_transforms';
import { antigravityTokenManager } from '../services/AntigravityTokenManager';
import { AntigravityService } from '../services/AntigravityService';
import { isAntigravityModel, extractRealModelName, getAntigravityModelNames, ANTIGRAVITY_SUFFIX } from '../config/antigravityConfig';
import { mapModelName } from '../utils/antigravityUtils';
import { calculateCliQuotaLimits, resolveCliUsageGroup, getCliUsageCount, CliQuotaLimits } from '../utils/cliQuota';
import {
    detectRequestFormat,
    normalizeToOpenAI,
    openaiResponseToGemini,
    openaiResponseToAnthropic,
    openaiStreamChunkToGemini,
    openaiStreamChunkToAnthropic,
    RequestFormat
} from '../utils/formatConverter';
import { redis } from '../utils/redis';

const prisma = new PrismaClient();
const poolManager = new CredentialPoolManager();

// Lua 脚本：原子化 RPM 限制检查
// 返回值: 当前计数 (如果已超限返回 -1)
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
    redis.call('EXPIRE', key, ttl)
end

if current > limit then
    return -1
end
return current
`;

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
    const cliSuffix = '-[星星公益站-CLI渠道]';
    const withStreamVariants = (model: string) => [
        `${model}-真流${cliSuffix}`,
        `${model}-假流${cliSuffix}`
    ];
    const cloudCodeModels = [
        ...withStreamVariants('gemini-2.5-flash'),
        ...withStreamVariants('gemini-2.5-pro'),
        // Disabled: gemini-3-pro-preview (CLI)
        // ...withStreamVariants('gemini-3-pro-preview'),
        ...withStreamVariants('gemini-3-pro-high'),
        ...withStreamVariants('gemini-3-pro-low'),
        ...withStreamVariants('gemini-3-flash-preview'),
        ...withStreamVariants('gemini-3-flash-minimal'),
        ...withStreamVariants('gemini-3-flash-medium'),
        ...withStreamVariants('gemini-3-flash-low'),
        ...withStreamVariants('gemini-3-flash-high')
    ];

    // 反重力渠道模型
    const antigravityModels = getAntigravityModelNames();

    return [...cloudCodeModels, ...antigravityModels];
}

function resolveCloudCodeModelName(modelName: string): string {
    const normalized = modelName.toLowerCase();
    if (normalized === 'gemini-3-pro-image-preview') return 'gemini-3-pro-image';
    if (normalized === 'gemini-3-pro-high' || normalized === 'gemini-3-pro-low') return 'gemini-3-pro-preview';
    if (normalized === 'gemini-3-flash-minimal'
        || normalized === 'gemini-3-flash-medium'
        || normalized === 'gemini-3-flash-low'
        || normalized === 'gemini-3-flash-high') {
        return 'gemini-3-flash-preview';
    }
    return modelName;
}

/**
 * 代理控制器
 * 处理各种 AI 模型的请求代理和转换
 * 支持 OpenAI、Gemini、Anthropic 等多种格式
 */
export class ProxyController {
    /** 模型缓存，5分钟过期 */
    private static modelsCache: { data: any[]; expiresAt: number } | null = null;

    /**
     * 处理聊天补全请求
     * 支持多种模型格式和渠道
     */
    static async handleChatCompletion(req: FastifyRequest, reply: FastifyReply) {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return reply.code(401).send({ error: '缺少 API 密钥' });
        }
        const apiKeyStr = authHeader.replace('Bearer ', '').trim();

        // 0. 快速健康检查 (在数据库/认证之前)
        // 立即拦截 "Hi" 消息以加速连接测试
        try {
            const body = req.body as any;
            const messages = body.messages || [];
            if (messages.length === 1 && messages[0].role === 'user' && messages[0].content === 'Hi') {
                return reply.send({
                    choices: [{ message: { role: 'assistant', content: 'Gemini Proxy 正常工作中' } }]
                });
            }
        } catch (e) { }

        // 1. 认证和速率限制
        const apiKeyData = await prisma.apiKey.findUnique({
            where: { key: apiKeyStr },
            include: { user: true }
        });

        if (!apiKeyData || !apiKeyData.is_active) {
            return reply.code(401).send({ error: '无效或已禁用的 API 密钥' });
        }

        const user = apiKeyData.user;

        if (!user.is_active) {
            return reply.code(401).send({ error: '🚫 您的账户已被禁用，请联系管理员解封。' });
        }

        const isAdminKey = (apiKeyData as any).type === 'ADMIN';
        let cliQuotaLimits: CliQuotaLimits | null = null;

        // 检查是否强制要求 Discord 绑定
        const forceBindSetting = await prisma.systemSetting.findUnique({ where: { key: 'FORCE_DISCORD_BIND' } });
        const forceDiscordBind = forceBindSetting ? forceBindSetting.value === 'true' : false;
        if (forceDiscordBind && !isAdminKey) {
            const userFull = await prisma.user.findUnique({ where: { id: user.id } }) as any;
            if (!userFull?.discordId) {
                return reply.code(401).send({ error: '请先绑定 Discord 账户后再使用服务' });
            }
        }

        // 获取凭证计数（用于权限检查和配额计算）
        // 冷却的凭证仍然算入配额增量，只有 DEAD 的不算
        const activeCredCount = await prisma.googleCredential.count({
            where: { owner_id: user.id, status: { in: [CredentialStatus.ACTIVE, CredentialStatus.COOLING] } }
        });
        const activeV3CredCount = await prisma.googleCredential.count({
            where: { owner_id: user.id, status: { in: [CredentialStatus.ACTIVE, CredentialStatus.COOLING] }, supports_v3: true }
        });

        // 全局共享模式拦截已移除；分别在各渠道分支内进行访问控制

        if (!isAdminKey) {
            // 获取系统配置
            const configSetting = await prisma.systemSetting.findUnique({ where: { key: 'SYSTEM_CONFIG' } });
            let rateLimit = 10; // 默认萌新速率限制

            /**
             * 辅助函数：从新嵌套格式或旧数字格式中提取配额值
             * @param levelConfig 等级配置
             * @param defaultValue 默认值
             * @returns 包含基础配额和增量配额的对象
             */
            const getQuotaValue = (levelConfig: any, defaultValue: number): { base: { flash: number; pro: number; v3: number }, increment: { flash: number; pro: number; v3: number } } => {
              if (typeof levelConfig === 'number') {
                // 旧格式：单一数字，按比例分配给各模型
                return { base: { flash: levelConfig, pro: Math.floor(levelConfig / 4), v3: Math.floor(levelConfig / 4) }, increment: { flash: 0, pro: 0, v3: 0 } };
              }
              if (levelConfig && typeof levelConfig === 'object' && levelConfig.base) {
                // 新嵌套格式：分模型配置基础配额和增量配额
                return {
                  base: {
                    flash: levelConfig.base?.flash ?? defaultValue,
                    pro: levelConfig.base?.pro ?? Math.floor(defaultValue / 4),
                    v3: levelConfig.base?.v3 ?? Math.floor(defaultValue / 4)
                  },
                  increment: {
                    flash: levelConfig.increment?.flash ?? 0,
                    pro: levelConfig.increment?.pro ?? 0,
                    v3: levelConfig.increment?.v3 ?? 0
                  }
                };
              }
              // 默认值处理
              return { base: { flash: defaultValue, pro: Math.floor(defaultValue / 4), v3: Math.floor(defaultValue / 4) }, increment: { flash: 0, pro: 0, v3: 0 } };
            };

            let totalQuota = 300; // 默认配额
            cliQuotaLimits = { flash: totalQuota, pro: totalQuota, v3: totalQuota, total: totalQuota };

            if (configSetting) {
                try {
                    const conf = JSON.parse(configSetting.value);
                    const limits = conf.rate_limit || {};

                    // 速率限制逻辑（基于用户等级/V3凭证数量）
                    if (activeV3CredCount > 0) rateLimit = limits.v3_contributor ?? 120; // V3贡献者：120 RPM
                    else if (activeCredCount > 0) rateLimit = limits.contributor ?? 60; // 贡献者：60 RPM
                    else rateLimit = limits.newbie ?? 10; // 萌新：10 RPM

                    const quotaConf = conf.quota || {};
                    
                    // 根据用户等级获取配额配置
                    let levelQuota: { base: { flash: number; pro: number; v3: number }, increment: { flash: number; pro: number; v3: number } };
                    if (activeV3CredCount > 0) {
                        // V3贡献者：3000默认配额
                        levelQuota = getQuotaValue(quotaConf.v3_contributor, 3000);
                    } else if (activeCredCount > 0) {
                        // 贡献者：1500默认配额
                        levelQuota = getQuotaValue(quotaConf.contributor, 1500);
                    } else {
                        // 萌新：300默认配额
                        levelQuota = getQuotaValue(quotaConf.newbie, 300);
                    }
                    
                    // 计算每个模型的总配额（基础配额 + 额外凭证增量）
                    const additionalCreds = Math.max(0, activeCredCount - 1); // 减去第一个凭证，只计算额外凭证
                    const flashQuota = levelQuota.base.flash + additionalCreds * levelQuota.increment.flash;
                    const proQuota = levelQuota.base.pro + additionalCreds * levelQuota.increment.pro;
                    const v3ModelQuota = levelQuota.base.v3 + additionalCreds * levelQuota.increment.v3;
                    
                    // 旧版增量兼容：支持旧的 increment_per_credential 字段
                    const legacyInc = quotaConf.increment_per_credential ?? 0;
                    const legacyExtra = additionalCreds * legacyInc;
                    
                    // 总配额：所有模型配额之和 + 旧版增量
                    totalQuota = flashQuota + proQuota + v3ModelQuota + legacyExtra;
                    cliQuotaLimits = calculateCliQuotaLimits(conf, activeCredCount, activeV3CredCount);
                } catch (e) {
                    console.error('解析系统配置失败:', e);
                }
            }

            // 配额检查：检查用户今日使用量是否超过总配额
            if (user.today_used >= totalQuota) {
                return reply.code(402).send({ error: `每日配额已用完 (${user.today_used}/${totalQuota})` });
            }

            // 速率限制检查：使用 Redis 实现每分钟请求数限制
            const rateKey = `RATE_LIMIT:${user.id}`;
            const currentRate = await redis.incr(rateKey);
            if (currentRate === 1) {
                await redis.expire(rateKey, 60); // 设置 60 秒过期
            }
            if (currentRate > rateLimit) {
                return reply.code(429).send({ error: `速率限制已超出 (${rateLimit}/分钟)` });
            }
        }

        // 2. 解析请求
        const openAIBody = req.body as any;
        // 兼容 prompt 参数格式：如果没有 messages，将 prompt 转换为 messages
        if (!openAIBody.messages && typeof openAIBody.prompt === 'string') {
            openAIBody.messages = [{ role: 'user', content: String(openAIBody.prompt) }];
        }
        // 将 temperature 限制在合理范围内，避免极端值影响反重力渠道
        if (typeof openAIBody.temperature === 'number') {
            openAIBody.temperature = Math.min(1.0, Math.max(0.1, openAIBody.temperature));
        }
        const requestedModel = openAIBody.model;
        const isStreaming = openAIBody.stream === true;

        // 检查是否是反重力渠道模型
        if (isAntigravityModel(requestedModel)) {
            return ProxyController.handleAntigravityRequest(req, reply, openAIBody, user, isAdminKey);
        }

        // Cloud Code 渠道模型映射逻辑
        let realModelName = requestedModel;
        let useFakeStream = false;

        // 处理模型后缀：移除公益站相关后缀
        if (requestedModel.includes('-[星星公益站-CLI渠道]') || requestedModel.includes('-[星星公益站-任何收费都是骗子]') || requestedModel.includes('-[星星公益站-所有收费都骗子]')) {
            // 移除后缀
            let base = requestedModel.replace('-[星星公益站-CLI渠道]', '').replace('-[星星公益站-任何收费都是骗子]', '').replace('-[星星公益站-所有收费都骗子]', '');

            // 检查流策略
            if (base.includes('-假流')) {
                useFakeStream = true;
                realModelName = base.replace('-假流', '');
            } else if (base.includes('-真流')) {
                realModelName = base.replace('-真流', '');
            } else {
                realModelName = base;
            }
        }

        // V3 模型逻辑
        const isV3Model = realModelName.includes('gemini-3') || realModelName.includes('gemini-exp');
        let poolType: 'GLOBAL' | 'V3' = 'GLOBAL';

        if (isV3Model) {
            // 检查 V3 权限
            const isAdmin = user.role === 'ADMIN';
            const hasV3Creds = activeV3CredCount > 0;
            // 新增开关：允许未上传或无3.0Pro权限也可使用3.0系列（CLI）
            const openAccessSetting = await prisma.systemSetting.findUnique({ where: { key: 'ENABLE_GEMINI3_OPEN_ACCESS' } });
            const enableOpenAccess = openAccessSetting ? openAccessSetting.value === 'true' : false;
            if (!enableOpenAccess) {
                if (!isAdmin && !hasV3Creds && !isAdminKey) {
                    return reply.code(401).send({
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
                return reply.code(401).send({
                    error: '🔒 已关闭 CLI 共享模式：仅上传过 CLI 凭证的用户可以使用 Cloud Code 渠道。'
                });
            }
        }

        if (!isAdminKey && cliQuotaLimits) {
            const { group } = resolveCliUsageGroup(realModelName);
            if (group !== 'other') {
                try {
                    const used = await getCliUsageCount(user.id, group);
                    const limit = cliQuotaLimits[group];
                    if (Number.isFinite(limit) && used >= limit) {
                        return reply.code(402).send({ error: `模型 ${realModelName} 每日配额已用完 (${used}/${limit})` });
                    }
                } catch (e: any) {
                    console.error('[Proxy] 模型配额检查失败:', e?.message || e);
                }
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

    /**
     * Gemini 格式的模型列表
     * 路由: GET /v1/models (当检测到 Gemini 客户端时使用)
     */
    static async handleListModelsGemini(req: FastifyRequest, reply: FastifyReply) {
        const models = getAvailableModels();

        const geminiModels = models.map(id => ({
            name: `models/${id}`,
            version: '001',
            displayName: id,
            description: `Model ${id}`,
            inputTokenLimit: 1000000,
            outputTokenLimit: 65536,
            supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
            temperature: 1.0,
            topP: 0.95,
            topK: 64
        }));

        return reply.send({ models: geminiModels });
    }

    /**
     * Anthropic 格式的模型列表（模拟端点）
     * 路由: GET /v1/models (当检测到 Anthropic 客户端时使用)
     */
    static async handleListModelsAnthropic(req: FastifyRequest, reply: FastifyReply) {
        const models = getAvailableModels();

        // 只返回 Claude 相关模型
        const claudeModels = models.filter(id => id.includes('claude'));

        const anthropicModels = claudeModels.map(id => ({
            type: 'model',
            id: id,
            display_name: id,
            created_at: new Date().toISOString()
        }));

        // Anthropic 没有官方模型列表端点，这是模拟格式
        return reply.send({
            data: anthropicModels,
            has_more: false,
            first_id: anthropicModels[0]?.id || null,
            last_id: anthropicModels[anthropicModels.length - 1]?.id || null
        });
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
        let agRateLimitIncrement = 0;
        let poolRoundRobin = true;
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
                agRateLimitIncrement = config.rate_limit_increment ?? 0;
                poolRoundRobin = config.pool_round_robin ?? true;
            }
        } catch (e) {
            console.error('Failed to load ANTIGRAVITY_CONFIG', e);
        }

        // Calculate Increment based on User's Tokens (ACTIVE + COOLING)
        // 冷却的凭证仍然算入配额增量，只有 DEAD 的不算
        const userTokenCount = await prisma.antigravityToken.count({
            where: {
                owner_id: user.id,
                status: { in: ['ACTIVE', 'COOLING'] },
                is_enabled: true
            }
        });

        const effectiveAgRateLimit = agRateLimit + (userTokenCount > 0 ? agRateLimitIncrement : 0);

        // 反重力渠道速率限制检查（每分钟请求数限制）- 使用 Lua 脚本保证原子性
        if (!isAdminKey && effectiveAgRateLimit > 0) {
            const now = Math.floor(Date.now() / 60000); // 当前分钟
            const rateKey = `AG_RATE:${user.id}:${now}`;
            
            // 使用 Lua 脚本原子化执行: INCR + 条件 EXPIRE + 限制检查
            // 返回 -1 表示已超限，否则返回当前计数
            const result = await redis.eval(RATE_LIMIT_SCRIPT, 1, rateKey, effectiveAgRateLimit, 120) as number;

            if (result === -1) {
                return reply.code(429).send({
                    error: {
                        message: `反重力渠道速率限制：每分钟最多 ${effectiveAgRateLimit} 次请求，请稍后再试`,
                        type: 'rate_limit_exceeded'
                    }
                });
            }
        }

        // Calculate Base Limit (Token or Request count)
        const base = useTokenQuota
            ? (group === 'gemini3' ? gemini3TokenQuota : claudeTokenQuota)
            : (group === 'gemini3' ? gemini3Limit : claudeLimit);

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
                return reply.code(401).send({
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
        const token = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3', modelId: actualModelId, poolRoundRobin }, user.id, initialTtl);
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
                            } catch { }
                            try { await antigravityTokenManager.markAsCooling(currentToken.id, cooldownMs); } catch { }
                            await antigravityTokenManager.releaseLock(currentToken.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3', poolRoundRobin }, user.id, 60000);
                            if (!next) throw err;
                            currentToken = next;
                            attempts++;
                            continue;
                        } else if (status === 403) {
                            try { await antigravityTokenManager.markAsDead(currentToken.id); } catch { }
                            await antigravityTokenManager.releaseLock(currentToken.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3', poolRoundRobin }, user.id, 60000);
                            if (!next) throw err;
                            currentToken = next;
                            attempts++;
                            continue;
                        } else if (status === 500) {
                            await antigravityTokenManager.releaseLock(currentToken.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3', poolRoundRobin }, user.id, 60000);
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
                try { await antigravityTokenManager.releaseLock(currentToken.id, user.id); } catch { }

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
                            } catch { }
                            try { await antigravityTokenManager.markAsCooling(currentToken2.id, cooldownMs); } catch { }
                            await antigravityTokenManager.releaseLock(currentToken2.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3', poolRoundRobin }, user.id, 30000);
                            if (!next) throw err;
                            currentToken2 = next;
                            attempts2++;
                            continue;
                        } else if (status === 403) {
                            try { await antigravityTokenManager.markAsDead(currentToken2.id); } catch { }
                            await antigravityTokenManager.releaseLock(currentToken2.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3', poolRoundRobin }, user.id, 30000);
                            if (!next) throw err;
                            currentToken2 = next;
                            attempts2++;
                            continue;
                        } else if (status === 500) {
                            await antigravityTokenManager.releaseLock(currentToken2.id, user.id);
                            const next = await antigravityTokenManager.getToken({ group: group as 'claude' | 'gemini3', poolRoundRobin }, user.id, 30000);
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
                try { await antigravityTokenManager.releaseLock(currentToken2.id, user.id); } catch { }
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
            } catch { }
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

        // Thinking (Gemini 3 thinking_level support, fallback to legacy heuristic)
        const modelName = String(openaiRequest.model || '').toLowerCase();
        const isGemini3Pro = modelName.includes('gemini-3-pro');
        const isGemini3Flash = modelName.includes('gemini-3-flash');
        const isImageModel = modelName.includes('image');
        const rawThinkingLevel = openaiRequest.thinking_level
            ?? openaiRequest.thinkingLevel
            ?? openaiRequest.thinkingConfig?.thinkingLevel
            ?? openaiRequest.thinkingConfig?.thinking_level
            ?? openaiRequest.generationConfig?.thinkingConfig?.thinkingLevel
            ?? openaiRequest.generationConfig?.thinkingConfig?.thinking_level
            ?? openaiRequest.generation_config?.thinking_config?.thinking_level
            ?? openaiRequest.generation_config?.thinking_config?.thinkingLevel;
        const derivedThinkingLevel = modelName.includes('gemini-3-pro-low')
            ? 'low'
            : modelName.includes('gemini-3-pro-high')
                ? 'high'
                : modelName.includes('gemini-3-flash-minimal')
                    ? 'minimal'
                    : modelName.includes('gemini-3-flash-medium')
                        ? 'medium'
                        : modelName.includes('gemini-3-flash-low')
                            ? 'low'
                            : modelName.includes('gemini-3-flash-high')
                                ? 'high'
                                : null;
        const candidateLevels: string[] = [];
        if (typeof rawThinkingLevel === 'string' && rawThinkingLevel.trim() !== '') {
            candidateLevels.push(rawThinkingLevel.trim().toLowerCase());
        }
        if (derivedThinkingLevel) candidateLevels.push(derivedThinkingLevel);
        if (!isImageModel && (isGemini3Pro || isGemini3Flash) && candidateLevels.length > 0) {
            const allowedLevels = isGemini3Flash
                ? ['minimal', 'medium', 'low', 'high']
                : ['low', 'high'];
            const selected = candidateLevels.find(level => allowedLevels.includes(level));
            if (selected) {
                generationConfig.thinkingConfig = { thinkingLevel: selected };
            }
        }
        if (!generationConfig.thinkingConfig && openaiRequest.model.includes('thinking')) {
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
        const usage = resolveCliUsageGroup(modelName);
        const key = usage.statsKey;
        const globalKey = usage.group === 'flash'
            ? 'flash'
            : usage.group === 'pro'
                ? 'pro'
                : usage.group === 'v3'
                    ? 'v3'
                    : 'other';

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
            model: resolveCloudCodeModelName(modelName),
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
                    const { statusCode, body } = await undiciRequest(endpoint, {
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

    // ============================================================
    // 多格式 API 兼容方法
    // ============================================================

    /**
     * 处理 Gemini 原生格式请求 (generateContent)
     * 路由: POST /v1/models/:model/generateContent
     */
    static async handleGeminiNative(req: FastifyRequest, reply: FastifyReply) {
        const { model } = req.params as { model: string };
        const body = req.body as any;

        // 合并模型到请求体
        const geminiBody = { ...body, model };

        // 转换为 OpenAI 格式处理
        const { request: openaiRequest } = normalizeToOpenAI(geminiBody, model);

        // 设置非流式
        openaiRequest.stream = false;

        // 创建模拟请求对象
        const modifiedReq = {
            ...req,
            body: openaiRequest
        } as FastifyRequest;

        // 使用包装器处理并转换响应
        const originalSend = reply.send.bind(reply);
        reply.send = (payload: any) => {
            // 转换响应为 Gemini 格式
            const geminiResponse = openaiResponseToGemini(payload);
            return originalSend(geminiResponse);
        };

        await ProxyController.handleChatCompletion(modifiedReq, reply);
    }

    /**
     * 处理 Gemini 原生格式流式请求 (streamGenerateContent)
     * 路由: POST /v1/models/:model/streamGenerateContent
     */
    static async handleGeminiNativeStream(req: FastifyRequest, reply: FastifyReply) {
        const { model } = req.params as { model: string };
        const body = req.body as any;

        // 合并模型到请求体并设置流式
        const geminiBody = { ...body, model, stream: true };

        // 转换为 OpenAI 格式
        const { request: openaiRequest } = normalizeToOpenAI(geminiBody, model);
        openaiRequest.stream = true;

        // 创建模拟请求
        const modifiedReq = {
            ...req,
            body: openaiRequest
        } as FastifyRequest;

        // 对于流式响应，我们需要包装原始响应流
        // 由于 handleChatCompletion 直接写入 reply.raw，这里需要特殊处理
        // 暂时使用简化方案：使用 OpenAI 格式返回
        // TODO: 实现完整的流式格式转换
        console.log('[MultiFormat] Gemini streaming request, model:', model);
        await ProxyController.handleChatCompletion(modifiedReq, reply);
    }

    /**
     * 处理 Anthropic 原生格式请求 (messages)
     * 路由: POST /v1/messages
     */
    static async handleAnthropicNative(req: FastifyRequest, reply: FastifyReply) {
        const body = req.body as any;
        const originalModel = body.model || 'claude-sonnet-4-5';
        const isStreaming = body.stream === true;

        // 转换为 OpenAI 格式
        const { request: openaiRequest } = normalizeToOpenAI(body);

        // 创建模拟请求
        const modifiedReq = {
            ...req,
            body: openaiRequest
        } as FastifyRequest;

        if (!isStreaming) {
            // 非流式：包装响应
            const originalSend = reply.send.bind(reply);
            reply.send = (payload: any) => {
                const anthropicResponse = openaiResponseToAnthropic(payload, originalModel);
                return originalSend(anthropicResponse);
            };
        }
        // 对于流式，暂时使用 OpenAI SSE 格式
        // TODO: 实现 Anthropic SSE 格式转换

        console.log('[MultiFormat] Anthropic request, model:', originalModel, 'streaming:', isStreaming);
        await ProxyController.handleChatCompletion(modifiedReq, reply);
    }

    /**
     * 通用入口：自动检测请求格式并处理
     * 可用于 /v1/chat/completions 自动兼容所有格式
     */
    static async handleUniversalRequest(req: FastifyRequest, reply: FastifyReply) {
        const body = req.body as any;
        const format = detectRequestFormat(body);

        console.log('[MultiFormat] Auto-detected format:', format);

        if (format === 'gemini') {
            // 检查是否流式
            if (body.stream === true) {
                return ProxyController.handleGeminiNativeStream(req, reply);
            }
            return ProxyController.handleGeminiNative(req, reply);
        } else if (format === 'anthropic') {
            return ProxyController.handleAnthropicNative(req, reply);
        } else {
            // OpenAI 格式，直接处理
            return ProxyController.handleChatCompletion(req, reply);
        }
    }
}
