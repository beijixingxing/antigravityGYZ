import { antigravityRequester } from './AntigravityRequester';
import { ANTIGRAVITY_CONFIG } from '../config/antigravityConfig';
import { ANTIGRAVITY_SUFFIX } from '../config/antigravityConfig';
import {
    AntigravityTokenData,
    generateAntigravityRequestBody,
    generateToolCallId
} from '../utils/antigravityUtils';

interface StreamState {
    thinkingStarted: boolean;
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

            if (parts) {
                for (const part of parts) {
                    if (part.thought === true) {
                        // 思维内容片段
                        if (!state.thinkingStarted) {
                            callback({ type: 'thinking', content: '<think>\n' });
                            state.thinkingStarted = true;
                        }
                        callback({ type: 'thinking', content: part.text || '' });
                    } else if (part.text !== undefined) {
                        // 普通文本片段
                        if (state.thinkingStarted) {
                            callback({ type: 'thinking', content: '\n</think>\n' });
                            state.thinkingStarted = false;
                        }
                        callback({ type: 'text', content: part.text });
                    } else if (part.functionCall) {
                        // 工具调用
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
                if (state.thinkingStarted) {
                    callback({ type: 'thinking', content: '\n</think>\n' });
                    state.thinkingStarted = false;
                }
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
            // ���Խ�������
        }
    }

    /**
     * ������ʽ��Ӧ
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

        const state: StreamState = { thinkingStarted: false, toolCalls: [] };
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
                        reject(new Error(`API Error ${statusCode}: ${errorBody}`));
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
        token: AntigravityTokenData
    ): Promise<{ content: string; toolCalls: any[]; usage: any }> {
        const headers = this.buildHeaders(token);
        const requestBody = generateAntigravityRequestBody(messages, model, params, tools, token);

        console.log('[AntigravityService] 发送请求到:', ANTIGRAVITY_CONFIG.api.noStreamUrl);
        console.log('[AntigravityService] 请求体 (部分):', JSON.stringify(requestBody).substring(0, 500));

        const response = await antigravityRequester.fetch(
            ANTIGRAVITY_CONFIG.api.noStreamUrl,
            {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                timeout_ms: ANTIGRAVITY_CONFIG.timeout
            }
        );

        console.log('[AntigravityService] 响应状态:', response.status, response.ok ? 'OK' : 'FAIL');

        // 直接检查状态码，不依赖 response.ok（二进制请求器可能返回错误的 ok 值）
        if (response.status >= 400 || !response.ok) {
            const errText = await response.text();
            console.log('[AntigravityService] 错误响应:', errText.substring(0, 500));
            throw new Error(`API Error ${response.status}: ${errText}`);
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
        let thinkingContent = '';
        const toolCalls: any[] = [];

        for (const part of parts) {
            if (part.thought === true) {
                thinkingContent += part.text || '';
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

        // 拼接思维内容
        if (thinkingContent) {
            content = `<think>\n${thinkingContent}\n</think>\n${content}`;
        }

        const usageData = data.response?.usageMetadata;
        const usage = usageData ? {
            prompt_tokens: usageData.promptTokenCount || 0,
            completion_tokens: usageData.candidatesTokenCount || 0,
            total_tokens: usageData.totalTokenCount || 0
        } : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

        return { content, toolCalls, usage };
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
