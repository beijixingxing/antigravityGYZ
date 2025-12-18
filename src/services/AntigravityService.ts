import { antigravityRequester } from './AntigravityRequester';
import { ANTIGRAVITY_CONFIG } from '../config/antigravityConfig';
import { ANTIGRAVITY_SUFFIX } from '../config/antigravityConfig';
import {
    AntigravityTokenData,
    generateAntigravityRequestBody,
    generateToolCallId
} from '../utils/antigravityUtils';
import { makeHttpError } from '../utils/http';

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
            'Accept-Encoding': 'gzip'
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
            const response = await antigravityRequester.fetch(
                ANTIGRAVITY_CONFIG.api.modelsUrl,
                {
                    method: 'POST',
                    headers,
                    body: '{}',
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
            const response = await antigravityRequester.fetch(
                ANTIGRAVITY_CONFIG.api.modelsUrl,
                {
                    method: 'POST',
                    headers,
                    body: '{}',
                    timeout_ms: 30000
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch quotas: ${response.status}`);
            }

            const data = await response.json();
            const quotas: Record<string, any> = {};

            Object.entries(data.models || {}).forEach(([modelId, modelData]: [string, any]) => {
                if (modelData.quotaInfo) {
                    quotas[modelId] = {
                        remaining: modelData.quotaInfo.remainingFraction,
                        resetTime: modelData.quotaInfo.resetTime
                    };
                }
            });

            return quotas;
        } catch (e) {
            console.error('[AntigravityService] Failed to fetch quotas:', e);
            return {};
        }
    }
}
