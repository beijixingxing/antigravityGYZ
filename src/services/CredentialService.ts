import { PrismaClient, CredentialStatus } from '@prisma/client';
import { request } from 'undici';
import { z } from 'zod';
import { CredentialPoolManager } from './CredentialPoolManager';
import { getUserAgent } from '../utils/system';

const prisma = new PrismaClient();
const poolManager = new CredentialPoolManager();

// 反代验证配置
const PROXY_VERIFY_PORT = process.env.PORT || 3000;

// 缓存系统管理员 Key（避免每次查询数据库）
let cachedAdminKey: string | null = null;

/**
 * 获取或创建系统管理员 API Key 用于反代验证
 * 优先使用已有的 ADMIN 类型 Key，没有则自动创建
 */
async function getOrCreateSystemAdminKey(): Promise<string> {
  // 如果已缓存，直接返回
  if (cachedAdminKey) return cachedAdminKey;

  // 1. 查找已有的 ADMIN 类型 Key
  const existingAdminKey = await prisma.apiKey.findFirst({
    where: {
      type: 'ADMIN',
      is_active: true
    },
    select: { key: true }
  });

  if (existingAdminKey) {
    cachedAdminKey = existingAdminKey.key;
    console.log('[CredentialService] 使用已有管理员 Key 进行验证');
    return cachedAdminKey;
  }

  // 2. 没有 ADMIN Key，查找管理员用户并创建一个
  const adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' }
  });

  if (!adminUser) {
    console.warn('[CredentialService] 没有找到管理员用户，反代验证可能失败');
    return 'no-admin-key-available';
  }

  // 3. 为管理员创建一个系统验证专用的 Key
  const crypto = require('crypto');
  const newKey = 'sk-sys-' + crypto.randomBytes(24).toString('hex');

  await prisma.apiKey.create({
    data: {
      key: newKey,
      name: '系统验证专用 (自动创建)',
      type: 'ADMIN',
      is_active: true,
      user_id: adminUser.id
    }
  });

  cachedAdminKey = newKey;
  console.log('[CredentialService] 自动创建系统管理员 Key 用于验证');
  return cachedAdminKey;
}


// Zod schema for input validation
const CredentialInputSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  refresh_token: z.string().min(1),
  project_id: z.string().optional(),
});

export class CredentialService {
  /**
   * Upload and verify a Google OAuth2 Credential.
   * 流程：解析 -> 获取 Token -> 临时入库 -> 加入池 -> 反代验证 -> 成功保留/失败删除
   */
  async uploadAndVerify(userId: number, jsonContent: string, requireV3: boolean = false) {
    // 1. Parse and Validate JSON structure
    let parsedJson;
    try {
      parsedJson = JSON.parse(jsonContent);
    } catch (e) {
      throw new Error('Invalid JSON format');
    }

    // Support both flat and nested (web/installed) formats
    const clientId = parsedJson.client_id || parsedJson.web?.client_id || parsedJson.installed?.client_id;
    const clientSecret = parsedJson.client_secret || parsedJson.web?.client_secret || parsedJson.installed?.client_secret;
    const refreshToken = parsedJson.refresh_token;
    const projectId: string = parsedJson.project_id || '';

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Invalid Credential JSON: Missing client_id, client_secret, or refresh_token');
    }

    // 2. Exchange Refresh Token for Access Token
    const accessToken = await this.refreshAccessToken(clientId, clientSecret, refreshToken);
    if (!accessToken) {
      throw new Error('❌ Token 刷新失败\n\n凭证可能已过期或无效');
    }

    // 2.1 Fetch Google account email and enforce uniqueness
    const googleEmail = await this.fetchGoogleEmail(accessToken);
    if (!googleEmail) {
      throw new Error('❌ 无法获取 Google 账号邮箱\n\n请确认凭证是否有效');
    }

    const existingByEmail = await prisma.googleCredential.findFirst({
      where: { google_email: googleEmail }
    });

    if (existingByEmail) {
      throw new Error('❌ 重复上传\n\n当前 Google 账号已经上传过凭证');
    }

    // 3. 先将凭证临时保存到数据库（VALIDATING 状态）
    let tempCredential: any = null;
    try {
      tempCredential = await prisma.googleCredential.create({
        data: {
          owner_id: userId,
          google_email: googleEmail,
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          project_id: projectId,
          access_token: accessToken,
          is_active: false, // 暂时不激活
          supports_v3: false,
          status: CredentialStatus.VALIDATING,
        },
      });
      console.log(`[CredentialService] 凭证临时入库: ID=${tempCredential.id}`);
    } catch (dbError: any) {
      console.error('[CredentialService] 临时入库失败:', dbError);
      throw new Error('❌ 数据库错误\n\n无法保存凭证');
    }

    // 4. 将凭证添加到 Redis 池
    try {
      await poolManager.addCredential(tempCredential.id, false);
      console.log(`[CredentialService] 凭证加入池: ID=${tempCredential.id}`);
    } catch (poolError: any) {
      // 加入池失败，删除数据库记录
      await prisma.googleCredential.delete({ where: { id: tempCredential.id } }).catch(() => { });
      console.error('[CredentialService] 加入池失败:', poolError);
      throw new Error('❌ 系统错误\n\n无法添加到凭证池');
    }

    // 5. 通过反代验证凭证
    let verifySuccess = false;
    let verifyError: string | null = null;
    let supportsV3 = false;

    try {
      // 5.1 基础验证 (gemini-2.5-flash)
      const baseResult = await this.verifyViaProxy(accessToken, projectId, 'gemini-2.5-flash');
      if (!baseResult.success) {
        // 429/5xx 在 verifyViaProxy 内已尝试回退；此处若失败，说明为明确失败（如 403/400）
        verifyError = baseResult.error || '❌ 凭证验证失败';
      } else {
        verifySuccess = true;
        console.log(`[CredentialService] 反代/CloudCode 验证通过: ID=${tempCredential.id}`);

        // 5.2 检测 Gemini 3.0 支持
        try {
          const v3Result = await this.verifyViaProxy(accessToken, projectId, 'gemini-3-pro-preview');
          if (v3Result.success) {
            supportsV3 = true;
            console.log(`[CredentialService] Gemini 3.0 支持: ID=${tempCredential.id}`);
          }
        } catch (v3Error) {
          console.warn(`[CredentialService] Gemini 3.0 检测失败: ${v3Error}`);
        }

        // 如果要求 V3 但不支持
        if (requireV3 && !supportsV3) {
          // 仅在明确不支持时失败；429/5xx 情况下不强制失败
          verifySuccess = false;
          verifyError = '❌ Gemini 3.0 验证失败或无法确认\n\n此凭证未确认支持 Gemini 3.0 模型';
        }
      }
    } catch (proxyError: any) {
      verifyError = `❌ 反代验证异常\n\n${proxyError.message}`;
    }

    // 6. 根据验证结果处理
    if (!verifySuccess) {
      // 验证失败：从池中移除并删除数据库记录
      try {
        const Redis = require('ioredis');
        const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        await redis.lrem('GLOBAL_CREDENTIAL_POOL', 0, String(tempCredential.id));
        redis.disconnect();
      } catch { }

      await prisma.googleCredential.delete({ where: { id: tempCredential.id } }).catch(() => { });
      console.log(`[CredentialService] 验证失败，已删除凭证: ID=${tempCredential.id}`);

      throw new Error(verifyError || '❌ 凭证验证失败');
    }

    // 7. 验证成功：更新状态并升级用户
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        // 更新凭证状态
        const credential = await tx.googleCredential.update({
          where: { id: tempCredential.id },
          data: {
            is_active: true,
            supports_v3: supportsV3,
            status: CredentialStatus.ACTIVE,
            last_validated_at: new Date(),
          },
        });

        // 升级用户
        await tx.user.update({
          where: { id: userId },
          data: { level: 1 },
        });

        return credential;
      });

      // 如果支持 V3，更新池
      if (supportsV3) {
        await poolManager.addCredential(result.id, true);
      }

      console.log(`[CredentialService] 验证成功: User ${userId}, Credential ID: ${result.id}, V3: ${supportsV3}`);
      return result;

    } catch (error: any) {
      console.error(`[CredentialService] 更新状态失败:`, error);
      throw new Error('❌ 系统错误\n\n凭证验证成功但保存失败');
    }
  }


  /**
   * Swaps a refresh token for a short-lived access token using undici.
   * Caches the token in Redis to improve performance.
   */
  private async refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string | null> {
    const cacheKey = `ACCESS_TOKEN:${clientId.slice(0, 10)}:${refreshToken.slice(-10)}`; // Simple hash key

    // 1. Try Cache
    // Create a local redis instance since we can't access poolManager's private one
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    const cached = await redis.get(cacheKey);
    if (cached) {
      redis.disconnect(); // Don't forget to close connection
      return cached;
    }

    const oauthUrl = process.env.GOOGLE_OAUTH_URL || 'https://oauth2.googleapis.com/token';
    try {
      const { statusCode, body } = await request(oauthUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (statusCode !== 200) {
        const errorText = await body.text();
        console.error(`[CredentialService] Token Refresh Failed (${statusCode}):`, errorText);
        redis.disconnect();
        return null;
      }

      const data = await body.json() as any;
      const accessToken = data.access_token;

      if (accessToken) {
        // Cache for 55 minutes (expires_in is usually 3600s)
        await redis.set(cacheKey, accessToken, 'EX', 3300);
      }

      redis.disconnect();
      return accessToken || null;

    } catch (error) {
      console.error('[CredentialService] Token Refresh Network Error:', error);
      redis.disconnect();
      return null;
    }
  }

  /**
   * Verifies the credential by making a real request to the internal Cloud Code API.
   * Uses the correct wrapper structure found in gemini-cli-core.
   */
  public async verifyCloudCodeAccess(accessToken: string, projectId?: string, modelName: string = 'gemini-2.5-flash', allow429: boolean = true): Promise<boolean> {
    const baseUrl = process.env.GOOGLE_CLOUD_CODE_URL || 'https://cloudcode-pa.googleapis.com';
    const targetUrl = `${baseUrl}/v1internal:generateContent`;

    // Use a more complete payload to avoid 400 errors from strict models
    const payload: any = {
      model: modelName,
      user_prompt_id: 'validation-check',
      request: {
        contents: [
          {
            role: "user",
            parts: [{ text: "Hi" }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 10,
          temperature: 0.1
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      }
    };
    if (projectId && projectId.trim() !== '') {
      payload.project = projectId;
    }

    try {
      const { statusCode, body } = await request(targetUrl, {
        method: 'POST',
        headers: {
          'User-Agent': getUserAgent(),
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        headersTimeout: 30000,
        bodyTimeout: 30000,
      });

      if (statusCode === 200) {
        try {
          const data = await body.json() as any;
          // Relaxed check: as long as it's 200 OK and valid JSON, we consider it a pass.
          // Safety blocks or empty content are still "valid access".
          if (data.candidates || data.promptFeedback) return true;

          console.warn(`[CredentialService] Validation 200 OK but weird structure: ${JSON.stringify(data)}`);
          return true;
        } catch (e) {
          console.error('[CredentialService] Failed to parse validation response:', e);
          return false;
        }
      }

      const errorText = await body.text();
      console.error(`[CredentialService] Validation Failed for ${modelName} (${statusCode}):`, errorText);

      // Special handling for 429: allow upload flow to proceed when allow429=true
      if (statusCode === 429) {
        return allow429;
      }

      // Other errors (e.g., 403) are treated as failures
      const err = new Error(`API Error ${statusCode}: ${errorText.substring(0, 200)}`);
      (err as any).statusCode = statusCode;
      throw err;

    } catch (error: any) {
      console.error(`[CredentialService] Network/API Error for ${modelName}:`, error.message);
      throw error; // Propagate up
    }
  }

  /**
   * 通过现有反代服务验证凭证
   * 直接将凭证临时添加到池中，发送测试请求，然后移除
   * 返回格式化的结果信息
   */
  public async verifyViaProxy(
    accessToken: string,
    projectId?: string,
    modelName: string = 'gemini-2.5-flash'
  ): Promise<{ success: boolean; response?: string; error?: string }> {
    const proxyUrl = `http://localhost:${PROXY_VERIFY_PORT}/v1/chat/completions`;

    try {
      console.log(`[CredentialService] 尝试通过反代验证凭证 (model: ${modelName})`);

      // 动态获取管理员 Key
      const adminKey = await getOrCreateSystemAdminKey();

      // 带 429/5xx 重试
      const doOnce = async () => {
        return await request(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminKey}`
          },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 10
          }),
          headersTimeout: 60000,
          bodyTimeout: 60000
        });
      };
      let attempt = 0;
      let statusCode: number = 0;
      let body: any;
      while (attempt < 3) {
        const res = await doOnce();
        statusCode = res.statusCode;
        body = res.body;
        if (statusCode === 429 || statusCode === 503 || statusCode === 502 || statusCode === 500) {
          const backoff = [500, 1500, 3000][attempt];
          console.warn(`[CredentialService] 反代验证遇到 ${statusCode}, 重试 ${attempt + 1}/3, 等待 ${backoff}ms`);
          await new Promise(r => setTimeout(r, backoff));
          attempt++;
          continue;
        }
        break;
      }


      const responseText = await body.text();

      if (statusCode === 200) {
        try {
          const data = JSON.parse(responseText);
          const content = data.choices?.[0]?.message?.content || '';
          console.log(`[CredentialService] 反代验证成功: ${content.substring(0, 50)}`);
          return {
            success: true,
            response: `✅ 验证成功！模型响应: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`
          };
        } catch {
          return { success: true, response: '✅ 验证成功！' };
        }
      } else {
        // 429/5xx 重试后仍失败：回退 Cloud Code 验证（允许 429）
        if (statusCode === 429 || statusCode === 503 || statusCode === 502 || statusCode === 500) {
          console.warn(`[CredentialService] 反代验证持续失败 (${statusCode})，回退到 Cloud Code 验证 (allow429=true)`);
          try {
            const ok = await this.verifyCloudCodeAccess(accessToken, projectId, modelName, true);
            if (ok) {
              return { success: true, response: '✅ 直连 Cloud Code 验证通过（429 视为通过）' };
            }
          } catch (fallbackErr: any) {
            const code = (fallbackErr as any).statusCode;
            const errText = String(fallbackErr.message || '');
            console.error('[CredentialService] Cloud Code 验证失败:', code, errText);
            if (code === 403 || code === 400) {
              return { success: false, error: `❌ 验证失败 (HTTP ${code})\n\n📋 错误详情:\n${errText}` };
            }
          }
        }
        // 其他错误：格式化返回
        let formattedError = `❌ 验证失败 (HTTP ${statusCode})`;
        try {
          const errData = JSON.parse(responseText);
          if (errData.error?.message) {
            formattedError += `\n\n📋 错误详情:\n${errData.error.message}`;
          } else if (errData.error) {
            formattedError += `\n\n📋 错误详情:\n${JSON.stringify(errData.error, null, 2)}`;
          }
        } catch {
          if (responseText.length > 0 && responseText.length < 500) {
            formattedError += `\n\n📋 原始响应:\n${responseText}`;
          }
        }
        console.error(`[CredentialService] 反代验证失败 (${statusCode}):`, responseText.substring(0, 200));
        return { success: false, error: formattedError };
      }
    } catch (error: any) {
      const formattedError = `❌ 反代服务连接失败\n\n📋 错误详情:\n${error.message}`;
      console.error('[CredentialService] 反代验证网络错误:', error.message);
      return { success: false, error: formattedError };
    }
  }

  /**
   * Fetch Google account email via userinfo endpoint using access token.

   * Returns null if request fails or email is missing.
   */
  private async fetchGoogleEmail(accessToken: string): Promise<string | null> {
    const url = 'https://www.googleapis.com/oauth2/v2/userinfo';

    try {
      const { statusCode, body } = await request(url, {
        method: 'GET',
        headers: {
          'User-Agent': getUserAgent(),
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        },
        headersTimeout: 30000,
        bodyTimeout: 30000
      });


      if (statusCode !== 200) {
        const text = await body.text();
        console.error(`[CredentialService] Fetch Google userinfo failed (${statusCode}):`, text);
        return null;
      }

      try {
        const data = await body.json() as any;
        const email = data?.email;
        if (typeof email === 'string' && email.length > 0) {
          return email;
        }
        console.warn('[CredentialService] Google userinfo has no email field.');
        return null;
      } catch (e) {
        console.error('[CredentialService] Failed to parse Google userinfo response:', e);
        return null;
      }
    } catch (error: any) {
      console.error('[CredentialService] Google userinfo request error:', error.message);
      return null;
    }
  }

  /**
   * Manually check if a stored credential supports Gemini 3.0
   * Returns object with detailed result
   * 当 Cloud Code API 失败时，通过反代服务验证
   */
  async checkV3Support(credential: any): Promise<{ supported: boolean; error?: string; response?: string }> {
    try {
      // 1. Refresh Token
      const accessToken = await this.refreshAccessToken(credential.client_id, credential.client_secret, credential.refresh_token);
      if (!accessToken) throw new Error('❌ Token 刷新失败\n\n凭证可能已过期或无效');

      // 2. Verify V3 via Cloud Code API
      let supportsV3 = false;
      let proxyResponse: string | undefined;

      try {
        await this.verifyCloudCodeAccess(accessToken, credential.project_id, 'gemini-3-pro-preview', false);
        supportsV3 = true;
      } catch (cloudCodeError: any) {
        console.warn(`[CredentialService] Cloud Code V3 验证失败，尝试反代验证: ${cloudCodeError.message}`);

        // Cloud Code 失败，尝试通过反代验证
        const proxyResult = await this.verifyViaProxy(accessToken, credential.project_id, 'gemini-3-pro-preview');

        if (proxyResult.success) {
          supportsV3 = true;
          proxyResponse = proxyResult.response;
          console.log(`[CredentialService] 反代验证 Gemini 3.0 通过`);
        } else {
          // 两种验证都失败，返回格式化错误
          return { supported: false, error: proxyResult.error };
        }
      }

      // 3. Update DB if changed (Only if credential exists in DB)
      if (credential.id && credential.supports_v3 !== supportsV3) {
        await prisma.googleCredential.update({
          where: { id: credential.id },
          data: { supports_v3: supportsV3 }
        });

        if (supportsV3) {
          await poolManager.addCredential(credential.id, true);
        }
      }

      return { supported: supportsV3, response: proxyResponse };
    } catch (e: any) {
      console.error(`[CredentialService] Check V3 failed for ${credential.id || 'RAW'}:`, e.message);
      return { supported: false, error: e.message };
    }
  }

}
