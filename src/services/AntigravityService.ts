import { antigravityRequester } from './AntigravityRequester';
import { ANTIGRAVITY_CONFIG } from '../config/antigravityConfig';
import { ANTIGRAVITY_SUFFIX } from '../config/antigravityConfig';
import {
    AntigravityTokenData,
    generateAntigravityRequestBody,
    generateToolCallId
} from '../utils/antigravityUtils';
import { makeHttpError } from '../utils/http';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

interface StreamState {
    toolCalls: any[];
}

/**
 * Antigravity API 服务
 */
export class AntigravityService {

    /**
     * 构造请求头
     */
    private static buildHeaders(token: AntigravityTokenData): Record<string, string> {
        return {
            'Host': ANTIGRAVITY_CONFIG.api.host,
            'User-Agent': ANTIGRAVITY_CONFIG.api.userAgent,
            'Authorization': `Bearer ${token.access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Goog-Api-Client': 'gl-node/20.0.0 antigravityGYZ'
        };
    }

    /**
     * 解析流式响应
     * 采用和 CLI 相同的处理方式：
     * - 思维内容 (thought=true) -> reasoning_content 字段
     * - 普通文本 -> content 字段
     * - 不使用 <think> 标签
     */
    private static parseStreamChunk(
        line: string,
        state: StreamState,
        callback: (data: any) => void
    ): void {
        if (!line.startsWith('data: ')) return;

        try {
            const data = JSON.parse(line.slice(6));
            const parts = data.response?.candidates?.[0]?.content?.parts;

            if (parts && parts.length > 0) {
                for (const part of parts) {
                    if (part.thought === true) {
                        // 思维内容 -> reasoning_content
                        callback({ type: 'reasoning', content: part.text || '' });
                    } else if (part.text !== undefined) {
                        // 普通文本 -> content
                        callback({ type: 'text', content: part.text });
                    } else if (part.functionCall) {
                        state.toolCalls.push({
                            id: part.functionCall.id || generateToolCallId(),
                            type: 'function',
                            function: {
                                name: part.functionCall.name,
                                arguments: JSON.stringify(part.functionCall.args)
                            }
                        });
                    }
                }
            }

            // 响应结束
            if (data.response?.candidates?.[0]?.finishReason) {
                // 输出工具调用
                if (state.toolCalls.length > 0) {
                    callback({ type: 'tool_calls', tool_calls: state.toolCalls });
                    state.toolCalls = [];
                }

                // Usage 统计
                const usage = data.response?.usageMetadata;
                if (usage) {
                    callback({
                        type: 'usage',
                        usage: {
                            prompt_tokens: usage.promptTokenCount || 0,
                            completion_tokens: usage.candidatesTokenCount || 0,
                            total_tokens: usage.totalTokenCount || 0
                        }
                    });
                }
            }
        } catch (e) {
            // 忽略解析错误
        }
    }

    /**
     * 流式响应
     */
    static async generateStreamResponse(
        messages: any[],
        model: string,
        params: any,
        tools: any[] | undefined,
        token: AntigravityTokenData,
        onChunk: (data: any) => void
    ): Promise<void> {
        const headers = this.buildHeaders(token);
        const requestBody = generateAntigravityRequestBody(messages, model, params, tools, token);

        const state: StreamState = {
            toolCalls: []
        };
        let buffer = '';

        const processChunk = (chunk: string) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            lines.forEach(line => this.parseStreamChunk(line, state, onChunk));
        };

        return new Promise((resolve, reject) => {
            const streamResponse = antigravityRequester.fetchStream(
                ANTIGRAVITY_CONFIG.api.streamUrl,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestBody),
                    timeout_ms: ANTIGRAVITY_CONFIG.timeout
                }
            );

            let statusCode: number | null = null;
            let errorBody = '';

            streamResponse
                .onStart(({ status }) => { statusCode = status; })
                .onData((chunk) => {
                    if (statusCode !== 200) {
                        errorBody += chunk;
                    } else {
                        processChunk(chunk);
                    }
                })
                .onEnd(() => {
                    if (statusCode !== 200) {
                        reject(makeHttpError(statusCode || 500, errorBody));
                    } else {
                        resolve();
                    }
                })
                .onError(reject);
        });
    }

    /**
     * 生成非流式响应
     */
    static async generateResponse(
        messages: any[],
        model: string,
        params: any,
        tools: any[] | undefined,
        token: AntigravityTokenData,
        opts?: { retry_on_429?: boolean; max_retries?: number }
    ): Promise<{ content: string; reasoningContent: string; toolCalls: any[]; usage: any }> {
        const headers = this.buildHeaders(token);
        const requestBody = generateAntigravityRequestBody(messages, model, params, tools, token);

        console.log('[AntigravityService] 发送请求到:', ANTIGRAVITY_CONFIG.api.noStreamUrl);
        console.log('[AntigravityService] 请求体 (部分):', JSON.stringify(requestBody).substring(0, 500));

        const doOnce = async () => {
            return await antigravityRequester.fetch(
                ANTIGRAVITY_CONFIG.api.noStreamUrl,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestBody),
                    timeout_ms: ANTIGRAVITY_CONFIG.timeout
                }
            );
        };
        let response = await doOnce();
        if (opts?.retry_on_429) {
            const max = Math.max(1, Math.min(opts.max_retries ?? 3, 5));
            let attempt = 0;
            while ((response.status === 429 || response.status === 503 || response.status === 502 || response.status === 500) && attempt < max) {
                const backoff = [500, 1500, 3000, 5000, 8000][attempt];
                console.warn(`[AntigravityService] 验证遇到 ${response.status}, 重试 ${attempt + 1}/${max}, 等待 ${backoff}ms`);
                await new Promise(r => setTimeout(r, backoff));
                response = await doOnce();
                attempt++;
            }
        }

        console.log('[AntigravityService] 响应状态:', response.status, response.ok ? 'OK' : 'FAIL');

        // 直接检查状态码，不依赖 response.ok（二进制请求器可能返回错误的 ok 值）
        if (response.status >= 400 || !response.ok) {
            const errText = await response.text();
            console.log('[AntigravityService] 错误响应:', errText.substring(0, 500));
            throw makeHttpError(response.status, errText);
        }

        const responseText = await response.text();
        console.log('[AntigravityService] 响应内容 (部分):', responseText.substring(0, 500));

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('[AntigravityService] 无法解析响应为 JSON');
            throw new Error(`API 返回无法解析的响应: ${responseText.substring(0, 200)}`);
        }


        const parts = data.response?.candidates?.[0]?.content?.parts || [];

        let content = '';
        let reasoningContent = '';
        const toolCalls: any[] = [];

        for (const part of parts) {
            if (part.thought === true) {
                reasoningContent += part.text || '';
            } else if (part.text !== undefined) {
                content += part.text;
            } else if (part.functionCall) {
                toolCalls.push({
                    id: part.functionCall.id || generateToolCallId(),
                    type: 'function',
                    function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args)
                    }
                });
            }
        }

        const usageData = data.response?.usageMetadata;
        const usage = usageData ? {
            prompt_tokens: usageData.promptTokenCount || 0,
            completion_tokens: usageData.candidatesTokenCount || 0,
            total_tokens: usageData.totalTokenCount || 0
        } : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

        return { content, reasoningContent, toolCalls, usage };
    }


    /**
     * 获取模型列表（从 API）
     */
    static async getAvailableModelsFromAPI(token: AntigravityTokenData): Promise<string[]> {
        const headers = this.buildHeaders(token);

        try {
            const payload: any = ANTIGRAVITY_CONFIG.skipProjectIdFetch
                ? {}
                : {
                    project: token.project_id || null,
                    metadata: { ideType: 'ANTIGRAVITY' }
                };
            if (!ANTIGRAVITY_CONFIG.skipProjectIdFetch && !payload.project) {
                try {
                    const resp = await antigravityRequester.fetch(
                        'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist',
                        {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } }),
                            timeout_ms: 15000
                        }
                    );
                    if (resp.ok) {
                        const info = await resp.json();
                        payload.project = info?.cloudaicompanionProject || null;
                        if (payload.project && token.id) {
                            await prisma.antigravityToken.update({
                                where: { id: token.id },
                                data: { project_id: String(payload.project) }
                            }).catch(() => { });
                        }
                    }
                } catch {}
            }
            const response = await antigravityRequester.fetch(
                ANTIGRAVITY_CONFIG.api.modelsUrl,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                    timeout_ms: 30000
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const data = await response.json();
            return Object.keys(data.models || {}).map(m => `${m}${ANTIGRAVITY_SUFFIX}`);
        } catch (e) {
            console.error('[AntigravityService] Failed to fetch models:', e);
            return [];
        }
    }

    /**
     * 获取模型配额信息
     */
    static async getModelsWithQuotas(token: AntigravityTokenData): Promise<Record<string, any>> {
        const headers = this.buildHeaders(token);

        try {
            const attemptEmpty = async () => {
                return await antigravityRequester.fetch(
                    ANTIGRAVITY_CONFIG.api.modelsUrl,
                    {
                        method: 'POST',
                        headers,
                        body: '{}',
                        timeout_ms: 30000
                    }
                );
            };
            const payloadBase: any = ANTIGRAVITY_CONFIG.skipProjectIdFetch
                ? {}
                : {
                    project: token.project_id || null,
                    metadata: { ideType: 'ANTIGRAVITY' }
                };
            // Fallback: resolve project_id if missing
            if (!ANTIGRAVITY_CONFIG.skipProjectIdFetch && !payloadBase.project) {
                try {
                    const resp = await antigravityRequester.fetch(
                        'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist',
                        {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } }),
                            timeout_ms: 15000
                        }
                    );
                    if (resp.ok) {
                        const info = await resp.json();
                        payloadBase.project = info?.cloudaicompanionProject || null;
                        if (payloadBase.project && token.id) {
                            await prisma.antigravityToken.update({
                                where: { id: token.id },
                                data: { project_id: String(payloadBase.project) }
                            }).catch(() => { });
                        }
                    }
                } catch {}
            }
            const doOnce = async () => {
                return await antigravityRequester.fetch(
                    ANTIGRAVITY_CONFIG.api.modelsUrl,
                    {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(payloadBase),
                        timeout_ms: 30000
                    }
                );
            };
            let response = await attemptEmpty();
            let attempt = 0;
            while ((response.status === 429 || response.status === 503 || response.status === 502 || response.status === 500) && attempt < 3) {
                const backoff = [500, 1500, 3000][attempt];
                await new Promise(r => setTimeout(r, backoff));
                response = await attemptEmpty();
                attempt++;
            }
            if (response.status >= 400 || !response.ok) {
                const errText = await response.text();
                throw makeHttpError(response.status, errText);
            }

            const data = await response.json();
            const quotas: Record<string, any> = {};

            Object.entries(data.models || {}).forEach(([modelId, modelData]: [string, any]) => {
                if (modelData.quotaInfo) {
                    const qi = modelData.quotaInfo;
                    quotas[modelId] = {
                        remaining: qi.remainingFraction,
                        resetTime: qi.resetTime || qi.resetTimeStamp || qi.quotaResetTimeStamp,
                        windowSeconds: qi.windowDurationSeconds ?? qi.quotaWindowSeconds ?? qi.windowSeconds
                    };
                }
            });
            // Ensure we always list models even if quotaInfo missing
            Object.keys(data.models || {}).forEach((modelId: string) => {
                if (!quotas[modelId]) {
                    quotas[modelId] = { remaining: null, resetTime: null, windowSeconds: null };
                }
            });

            if (Object.keys(quotas).length === 0) {
                // Retry with project payload if empty payload did not provide quotaInfo
                let resp2 = await doOnce();
                let att2 = 0;
                while ((resp2.status === 429 || resp2.status === 503 || resp2.status === 502 || resp2.status === 500) && att2 < 3) {
                    const backoff = [500, 1500, 3000][att2];
                    await new Promise(r => setTimeout(r, backoff));
                    resp2 = await doOnce();
                    att2++;
                }
                if (resp2.status < 400 && resp2.ok) {
                    const data2 = await resp2.json();
                    Object.entries(data2.models || {}).forEach(([modelId, modelData]: [string, any]) => {
                        if (modelData.quotaInfo) {
                            const qi = modelData.quotaInfo;
                            quotas[modelId] = {
                                remaining: qi.remainingFraction,
                                resetTime: qi.resetTime || qi.resetTimeStamp || qi.quotaResetTimeStamp,
                                windowSeconds: qi.windowDurationSeconds ?? qi.quotaWindowSeconds ?? qi.windowSeconds
                            };
                        }
                    });
                }
            }

            const noWindowInfo = Object.keys(quotas).length === 0 ||
                Object.values(quotas).every((q: any) => !q.resetTime && !q.windowSeconds);
            if (noWindowInfo) {
                try {
                    const setting = await prisma.systemSetting.findUnique({ where: { key: 'ENABLE_QUOTA_PROBE' } });
                    const enabled = setting ? setting.value === 'true' : false;
                    if (enabled) {
                        const key = `AG_QPROBE_DAILY:${String(token.id)}`;
                        const n = await redis.incr(key);
                        if (n === 1) { await redis.expire(key, 86400); }
                        if (n === 1) {
                            const probeBody = generateAntigravityRequestBody(
                                [{ role: 'user', parts: [{ text: 'hello' }] }],
                                'gemini-2.5-flash',
                                {},
                                undefined,
                                token
                            );
                            const probeResp = await antigravityRequester.fetch(
                                ANTIGRAVITY_CONFIG.api.noStreamUrl,
                                {
                                    method: 'POST',
                                    headers,
                                    body: JSON.stringify(probeBody),
                                    timeout_ms: 20000
                                }
                            );
                            if (probeResp.status >= 400) {
                                const errText = await probeResp.text();
                                try {
                                    const errObj = JSON.parse(errText);
                                    const details = errObj?.error?.details || [];
                                    for (const d of details) {
                                        if (d['@type'] && String(d['@type']).includes('google.rpc.ErrorInfo')) {
                                            const ts = d?.metadata?.quotaResetTimeStamp;
                                            if (ts) {
                                                const resetMs = new Date(ts).getTime();
                                                const winSec = Math.max(0, Math.floor((resetMs - Date.now()) / 1000));
                                                quotas['gemini-2.5-flash'] = {
                                                    remaining: null,
                                                    resetTime: ts,
                                                    windowSeconds: winSec
                                                };
                                                break;
                                            }
                                        }
                                    }
                                } catch { }
                            }
                        }
                    }
                } catch { }
            }

            return quotas;
        } catch (e) {
            console.error('[AntigravityService] Failed to fetch quotas:', e);
            return {};
        }
    }
}
