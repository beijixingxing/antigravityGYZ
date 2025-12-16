import { randomUUID } from 'crypto';
import { ANTIGRAVITY_CONFIG } from '../config/antigravityConfig';

export function generateProjectId(): string {
    const adjectives = ['useful', 'bright', 'swift', 'calm', 'bold'];
    const nouns = ['fuze', 'wave', 'spark', 'flow', 'core'];
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNum = Math.random().toString(36).substring(2, 7);
    return randomAdj + '-' + randomNoun + '-' + randomNum;
}

export function generateSessionId(): string {
    return String(-Math.floor(Math.random() * 9e18));
}

export function generateRequestId(): string {
    return 'agent-' + randomUUID();
}

export function generateToolCallId(): string {
    return 'call_' + randomUUID().replace(/-/g, '');
}

export interface AntigravityTokenData {
    id: number;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    timestamp: bigint;
    project_id: string | null;
    session_id: string | null;
}

export function extractImagesFromContent(content: any): { text: string; images: any[] } {
    const result: { text: string; images: any[] } = { text: '', images: [] };
    if (typeof content === 'string') {
        result.text = content;
        return result;
    }
    if (Array.isArray(content)) {
        for (const item of content) {
            if (item.type === 'text') {
                result.text += item.text;
            } else if (item.type === 'image_url') {
                const imageUrl = item.image_url?.url || '';
                const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
                if (match) {
                    result.images.push({ inlineData: { mimeType: 'image/' + match[1], data: match[2] } });
                }
            }
        }
    }
    return result;
}

export function convertMessagesToAntigravity(messages: any[]): any[] {
    const antigravityMessages: any[] = [];
    for (const message of messages) {
        if (message.role === 'user' || message.role === 'system') {
            const extracted = extractImagesFromContent(message.content);
            antigravityMessages.push({ role: 'user', parts: [{ text: extracted.text }, ...extracted.images] });
        } else if (message.role === 'assistant') {
            const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;
            const hasContent = message.content && message.content.trim() !== '';
            const lastMessage = antigravityMessages[antigravityMessages.length - 1];
            const antigravityTools = hasToolCalls ? message.tool_calls.map((tc: any) => ({
                functionCall: { id: tc.id, name: tc.function.name, args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments }
            })) : [];
            if (lastMessage?.role === 'model' && hasToolCalls && !hasContent) {
                lastMessage.parts.push(...antigravityTools);
            } else {
                const parts: any[] = [];
                if (hasContent) parts.push({ text: message.content.trimEnd() });
                parts.push(...antigravityTools);
                antigravityMessages.push({ role: 'model', parts });
            }
        } else if (message.role === 'tool') {
            let functionName = '';
            for (let i = antigravityMessages.length - 1; i >= 0; i--) {
                if (antigravityMessages[i].role === 'model') {
                    for (const part of antigravityMessages[i].parts) {
                        if (part.functionCall && part.functionCall.id === message.tool_call_id) { functionName = part.functionCall.name; break; }
                    }
                    if (functionName) break;
                }
            }
            const lastMessage = antigravityMessages[antigravityMessages.length - 1];
            const functionResponse = { functionResponse: { id: message.tool_call_id, name: functionName || message.name, response: { output: message.content } } };
            if (lastMessage?.role === 'user' && lastMessage.parts.some((p: any) => p.functionResponse)) {
                lastMessage.parts.push(functionResponse);
            } else {
                antigravityMessages.push({ role: 'user', parts: [functionResponse] });
            }
        }
    }
    return antigravityMessages;
}

export function convertToolsToAntigravity(openaiTools: any[] | undefined): any[] {
    if (!openaiTools || openaiTools.length === 0) return [];
    return openaiTools.map(tool => {
        const params = { ...tool.function.parameters };
        if (params['$schema']) delete params['$schema'];
        return { functionDeclarations: [{ name: tool.function.name, description: tool.function.description, parameters: params }] };
    });
}

export function isThinkingModel(modelName: string): boolean {
    // 包含 -thinking 的模型都启用思考
    if (modelName.includes('-thinking')) return true;
    // gemini 3 pro 系列
    if (modelName.startsWith('gemini-3-pro') || modelName === 'gemini-2.5-pro') return true;
    // 纯净版不启用思考
    return false;
}

// 根据模型名称获取思考预算
export function getThinkingBudget(modelName: string): number {
    // 8k 版本
    if (modelName.endsWith('-8k')) return 8192;
    // 4k 版本
    if (modelName.endsWith('-4k')) return 4096;
    // 1k 版本
    if (modelName.endsWith('-1k')) return 1024;
    // gemini 3 pro 系列
    if (modelName.startsWith('gemini-3-pro')) return 4096;
    // 其他包含 -thinking 的模型默认 4096
    if (modelName.includes('-thinking')) return 4096;
    // 纯净版（无 thinking 后缀）返回 0，不启用思考
    return 0;
}

export function mapModelName(modelName: string): string {
    // 移除思考预算后缀，映射到实际 API 模型名
    let baseName = modelName.replace(/-1k$/, '').replace(/-4k$/, '').replace(/-8k$/, '');

    // 所有 Claude 模型都必须使用 -thinking 版本（API 只支持 thinking 版本）
    // claude-opus-4-5 或 claude-opus-4-5-thinking -> claude-opus-4-5-thinking
    if (baseName === 'claude-opus-4-5' || baseName === 'claude-opus-4-5-thinking') {
        return 'claude-opus-4-5-thinking';
    }
    // claude-sonnet-4-5 或 claude-sonnet-4-5-thinking -> claude-sonnet-4-5-thinking
    if (baseName === 'claude-sonnet-4-5' || baseName === 'claude-sonnet-4-5-thinking') {
        return 'claude-sonnet-4-5-thinking';
    }
    if (baseName === 'gemini-2.5-flash-thinking') return 'gemini-2.5-flash';
    if (baseName === 'gemini-3-pro-preview') return 'gemini-3-pro-high';
    return baseName;
}

export function generateAntigravityRequestBody(
    messages: any[],
    modelName: string,
    params: any,
    tools: any[] | undefined,
    token: AntigravityTokenData,
    systemInstruction?: string
): any {
    const enableThinking = isThinkingModel(modelName);
    const actualModelName = mapModelName(modelName);

    const normalized = normalizeParams(params);
    const stopSeqs = normalized.stop ?? ['<|user|>', '<|bot|>', '<|context_request|>', '<|endoftext|>', '<|end_of_turn|>'];

    const thinkingBudget = getThinkingBudget(modelName);

    const generationConfig: any = {
        topP: normalized.topP,
        topK: normalized.topK,
        temperature: normalized.temperature,
        candidateCount: 1,
        maxOutputTokens: normalized.maxTokens,
        stopSequences: stopSeqs
    };

    // 只有启用思考且预算 > 0 时才添加 thinkingConfig
    if (enableThinking && thinkingBudget > 0) {
        generationConfig.thinkingConfig = {
            includeThoughts: true,
            thinkingBudget: thinkingBudget
        };
    }

    if (enableThinking && actualModelName.includes('claude')) {
        delete generationConfig.topP;
    }

    const requestBody: any = {
        requestId: generateRequestId(),
        request: {
            contents: convertMessagesToAntigravity(messages),
            generationConfig,
            sessionId: token.session_id
        },
        model: actualModelName,
        userAgent: 'antigravity'
    };
    if (token.project_id && token.project_id.trim() !== '') {
        requestBody.project = token.project_id;
    }

    if (systemInstruction) {
        requestBody.request.systemInstruction = { role: 'user', parts: [{ text: systemInstruction }] };
    }

    const antigravityTools = convertToolsToAntigravity(tools);
    if (antigravityTools.length > 0) {
        requestBody.request.tools = antigravityTools;
        requestBody.request.toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
    }

    return requestBody;
}

export function normalizeParams(params: any = {}): {
    temperature: number;
    topP: number;
    topK: number;
    maxTokens: number;
    stop?: string[];
} {
    const tempRaw = params.temperature ?? params.temp ?? ANTIGRAVITY_CONFIG.defaults.temperature;
    let temperature = Number(tempRaw);
    if (!Number.isFinite(temperature)) temperature = ANTIGRAVITY_CONFIG.defaults.temperature;
    temperature = Math.min(1.0, Math.max(0.1, temperature));

    let topP = Number(params.top_p ?? params.topP ?? ANTIGRAVITY_CONFIG.defaults.topP);
    if (!Number.isFinite(topP)) topP = ANTIGRAVITY_CONFIG.defaults.topP;
    topP = Math.min(1.0, Math.max(0.0, topP));
    let topK = Number(params.top_k ?? params.topK ?? ANTIGRAVITY_CONFIG.defaults.topK);
    if (!Number.isFinite(topK)) topK = ANTIGRAVITY_CONFIG.defaults.topK;
    topK = Math.max(1, Math.min(1000, Math.round(topK)));
    let maxTokens = Number(params.max_tokens ?? params.max_completion_tokens ?? ANTIGRAVITY_CONFIG.defaults.maxTokens);
    if (!Number.isFinite(maxTokens)) maxTokens = ANTIGRAVITY_CONFIG.defaults.maxTokens;
    maxTokens = Math.max(256, Math.min(50000, Math.round(maxTokens)));

    const stop = Array.isArray(params.stop) ? params.stop : undefined;

    return { temperature, topP, topK, maxTokens, stop };
}
