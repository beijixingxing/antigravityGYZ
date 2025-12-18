/**
 * Antigravity 配置
 */
export const ANTIGRAVITY_CONFIG = {
  api: {
    streamUrl: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse',
    noStreamUrl: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent',
    modelsUrl: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
    host: 'daily-cloudcode-pa.sandbox.googleapis.com',
    userAgent: 'antigravity/1.11.9 windows/amd64'
  },
  oauth: {
    clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
    clientSecret: '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',
    tokenUrl: 'https://oauth2.googleapis.com/token'
  },
  defaults: {
    temperature: 1,
    topP: 0.85,
    topK: 50,
    maxTokens: 50000
  },
  timeout: 180000,
  skipProjectIdFetch: true
};

// 支持的反重力渠道模型
export const ANTIGRAVITY_MODELS = [
  // Claude Opus 4.5 系列
  'claude-opus-4-5',                    // 纯净版，无思考
  'claude-opus-4-5-thinking-1k',        // 1k 思考预算
  'claude-opus-4-5-thinking-4k',
  'claude-opus-4-5-thinking-8k',
  // Gemini 3 Pro 系列
  'gemini-3-pro-preview',
  // Claude Sonnet 4.5 系列
  'claude-sonnet-4-5',                  // 纯净版，无思考
  'claude-sonnet-4-5-thinking-1k',      // 1k 思考预算
  'claude-sonnet-4-5-thinking-4k',
  'claude-sonnet-4-5-thinking-8k'
];

// 模型后缀（用于在前端展示并进行路由分流）
export const ANTIGRAVITY_SUFFIX = '-[星星公益站-反重力渠道]';
export const ANTIGRAVITY_SUFFIXES = ['-[星星公益站-反重力渠道]', '-[���ǹ���վ-����������]'];

// 获取反重力渠道模型名称列表
export function getAntigravityModelNames(): string[] {
  return ANTIGRAVITY_MODELS.map(m => `${m}${ANTIGRAVITY_SUFFIX}`);
}

// 判断是否为反重力渠道模型
export function isAntigravityModel(modelName: string): boolean {
  return ANTIGRAVITY_SUFFIXES.some(sfx => modelName.includes(sfx));
}

// 从带后缀的模型名称提取真实模型名
export function extractRealModelName(modelName: string): string {
  let name = modelName;
  for (const sfx of ANTIGRAVITY_SUFFIXES) {
    if (name.includes(sfx)) name = name.replace(sfx, '');
  }
  return name;
}
