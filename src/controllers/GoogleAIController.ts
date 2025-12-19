import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient, CredentialStatus } from '@prisma/client';
import Redis from 'ioredis';
import { PassThrough, Transform } from 'stream';
import { getUserAgent } from '../utils/system';
import { makeHttpError, isHttpError } from '../utils/http';
import { CredentialPoolManager } from '../services/CredentialPoolManager';
import { extractRealModelName, isAntigravityModel } from '../config/antigravityConfig';
import { ProxyController } from './ProxyController';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const poolManager = new CredentialPoolManager();

function isV3ModelName(name: string): boolean {
  return name.includes('gemini-3') || name.includes('gemini-exp');
}

function stripCliSuffixAndStrategy(model: string): { real: string; fakeStream: boolean } {
  let m = model.replace('-[星星公益站-CLI渠道]', '')
               .replace('-[星星公益站-任何收费都是骗子]', '')
               .replace('-[星星公益站-所有收费都骗子]', '');
  let fake = false;
  if (m.includes('-假流')) {
    fake = true;
    m = m.replace('-假流', '');
  } else if (m.includes('-真流')) {
    m = m.replace('-真流', '');
  }
  return { real: m, fakeStream: fake };
}

async function verifyAuth(req: FastifyRequest, reply: FastifyReply): Promise<{ apiKey: any; user: any } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'Missing API Key' });
    return null;
  }
  const apiKeyStr = authHeader.replace('Bearer ', '').trim();
  const apiKeyData = await prisma.apiKey.findUnique({ where: { key: apiKeyStr }, include: { user: true } });
  if (!apiKeyData || !apiKeyData.is_active) {
    await reply.code(401).send({ error: 'Invalid or disabled API Key' });
    return null;
  }
  const user = apiKeyData.user;
  if (!user.is_active) {
    await reply.code(403).send({ error: '🚫 您的账户已被禁用，请联系管理员解封。' });
    return null;
  }
  return { apiKey: apiKeyData, user };
}

export class GoogleAIController {
  static async listModels(req: FastifyRequest, reply: FastifyReply) {
    const models = (ProxyController as any).modelsCache?.data
      ? (ProxyController as any).modelsCache.data.map((m: any) => m.id)
      : (function() { const fn = (ProxyController as any).handleListModels; return null; })() || [];
    const ids = models.length > 0 ? models : (function get() {
      // fallback pull fresh list
      return (require('./ProxyController') as any).getAvailableModels
        ? (require('./ProxyController') as any).getAvailableModels()
        : [];
    })();
    const plain = ids.map((id: string) => stripCliSuffixAndStrategy(id).real);
    return reply.send({ models: ids, plain_models: Array.from(new Set(plain)) });
  }

  static async generateContent(req: FastifyRequest, reply: FastifyReply) {
    const auth = await verifyAuth(req, reply);
    if (!auth) return;
    const { apiKey, user } = auth;
    const isAdminKey = (apiKey as any).type === 'ADMIN';
    const body = req.body as any;
    const modelParam = (req.params as any).model as string;

    if (isAntigravityModel(modelParam)) {
      return reply.code(400).send({ error: 'Antigravity channel is not supported in GoogleAI endpoints' });
    }

    const stripped = stripCliSuffixAndStrategy(modelParam);
    const realModelName = stripped.real;
    const isV3 = isV3ModelName(realModelName);
    let poolType: 'GLOBAL' | 'V3' = 'GLOBAL';

    const activeCredCount = await prisma.googleCredential.count({
      where: { owner_id: user.id, status: { in: [CredentialStatus.ACTIVE, CredentialStatus.COOLING] } }
    });
    const activeV3CredCount = await prisma.googleCredential.count({
      where: { owner_id: user.id, status: { in: [CredentialStatus.ACTIVE, CredentialStatus.COOLING] }, supports_v3: true }
    });

    if (isV3) {
      const isAdmin = user.role === 'ADMIN';
      const hasV3Creds = activeV3CredCount > 0;
      const openAccessSetting = await prisma.systemSetting.findUnique({ where: { key: 'ENABLE_GEMINI3_OPEN_ACCESS' } });
      const enableOpenAccess = openAccessSetting ? openAccessSetting.value === 'true' : false;
      if (!enableOpenAccess) {
        if (!isAdmin && !hasV3Creds && !isAdminKey) {
          return reply.code(403).send({ error: '🔒 此模型 (Gemini 3.0) 仅限管理员或上传了 3.0 凭证的用户使用。' });
        }
      }
      poolType = 'V3';
    }

    const cliSharedSetting = await prisma.systemSetting.findUnique({ where: { key: 'ENABLE_CLI_SHARED_MODE' } });
    let isCliSharedMode = cliSharedSetting ? cliSharedSetting.value === 'true' : true;
    if (cliSharedSetting == null) {
      const legacy = await prisma.systemSetting.findUnique({ where: { key: 'ENABLE_SHARED_MODE' } });
      isCliSharedMode = legacy ? legacy.value === 'true' : true;
    }
    if (!isCliSharedMode && !isAdminKey) {
      const isAdmin = user.role === 'ADMIN';
      const hasCliCredential = activeCredCount > 0;
      if (!isAdmin && !hasCliCredential) {
        return reply.code(403).send({ error: '🔒 已关闭 CLI 共享模式：仅上传 CLI 凭证的用户可以使用 Cloud Code 渠道。' });
      }
    }

    if (!isAdminKey) {
      await prisma.user.update({ where: { id: user.id }, data: { today_used: { increment: 1 } } }).catch(() => { });
    }

    const cred = await poolManager.getRoundRobinCredential(poolType, user.id, 30000);
    if (!cred) {
      return reply.code(500).send({ error: 'No valid credentials available' });
    }

    const finalPayload = {
      model: realModelName,
      project: cred.projectId,
      request: body
    };

    try {
      const googleResponse = await (ProxyController as any).sendGeminiRequest(
        realModelName, body, false, cred.credentialId, cred.accessToken, cred.projectId
      );
      await (ProxyController as any).recordSuccessfulCall(cred.credentialId, realModelName, user.id);
      const resp = reply.send(googleResponse);
      try { await poolManager.releaseLock(cred.credentialId, user.id); } catch {}
      return resp;
    } catch (error: any) {
      if (isHttpError(error)) {
        const r = reply.code(error.statusCode || 500).send({ error: error.body || error.message });
        try { await poolManager.releaseLock(cred.credentialId, user.id); } catch {}
        return r;
      }
      const r = reply.code(500).send({ error: error.message || 'Internal error' });
      try { await poolManager.releaseLock(cred.credentialId, user.id); } catch {}
      return r;
    }
  }

  static async streamGenerateContent(req: FastifyRequest, reply: FastifyReply) {
    const auth = await verifyAuth(req, reply);
    if (!auth) return;
    const { apiKey, user } = auth;
    const isAdminKey = (apiKey as any).type === 'ADMIN';
    const body = req.body as any;
    const modelParam = (req.params as any).model as string;

    if (isAntigravityModel(modelParam)) {
      reply.code(400).send({ error: 'Antigravity channel is not supported in GoogleAI endpoints' });
      return;
    }

    const stripped = stripCliSuffixAndStrategy(modelParam);
    const realModelName = stripped.real;
    const isV3 = isV3ModelName(realModelName);
    let poolType: 'GLOBAL' | 'V3' = 'GLOBAL';

    const activeCredCount = await prisma.googleCredential.count({
      where: { owner_id: user.id, status: { in: [CredentialStatus.ACTIVE, CredentialStatus.COOLING] } }
    });
    const activeV3CredCount = await prisma.googleCredential.count({
      where: { owner_id: user.id, status: { in: [CredentialStatus.ACTIVE, CredentialStatus.COOLING] }, supports_v3: true }
    });

    if (isV3) {
      const isAdmin = user.role === 'ADMIN';
      const hasV3Creds = activeV3CredCount > 0;
      const openAccessSetting = await prisma.systemSetting.findUnique({ where: { key: 'ENABLE_GEMINI3_OPEN_ACCESS' } });
      const enableOpenAccess = openAccessSetting ? openAccessSetting.value === 'true' : false;
      if (!enableOpenAccess) {
        if (!isAdmin && !hasV3Creds && !isAdminKey) {
          reply.code(403).send({ error: '🔒 此模型 (Gemini 3.0) 仅限管理员或上传了 3.0 凭证的用户使用。' });
          return;
        }
      }
      poolType = 'V3';
    }

    const cliSharedSetting = await prisma.systemSetting.findUnique({ where: { key: 'ENABLE_CLI_SHARED_MODE' } });
    let isCliSharedMode = cliSharedSetting ? cliSharedSetting.value === 'true' : true;
    if (cliSharedSetting == null) {
      const legacy = await prisma.systemSetting.findUnique({ where: { key: 'ENABLE_SHARED_MODE' } });
      isCliSharedMode = legacy ? legacy.value === 'true' : true;
    }
    if (!isCliSharedMode && !isAdminKey) {
      const isAdmin = user.role === 'ADMIN';
      const hasCliCredential = activeCredCount > 0;
      if (!isAdmin && !hasCliCredential) {
        reply.code(403).send({ error: '🔒 已关闭 CLI 共享模式：仅上传 CLI 凭证的用户可以使用 Cloud Code 渠道。' });
        return;
      }
    }

    if (!isAdminKey) {
      await prisma.user.update({ where: { id: user.id }, data: { today_used: { increment: 1 } } }).catch(() => { });
    }

    const cred = await poolManager.getRoundRobinCredential(poolType, user.id, 60000);
    if (!cred) {
      reply.code(500).send({ error: 'No valid credentials available' });
      return;
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    try {
      await (ProxyController as any).sendGeminiRequest(
        realModelName, body, true, cred.credentialId, cred.accessToken, cred.projectId,
        async (line: string) => {
          // 直接透传原生行
          reply.raw.write(`${line}\n`);
        }
      );
      await (ProxyController as any).recordSuccessfulCall(cred.credentialId, realModelName, user.id);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      try { await poolManager.releaseLock(cred.credentialId, user.id); } catch {}
    } catch (error: any) {
      const status = isHttpError(error) ? error.statusCode : 500;
      const msg = isHttpError(error) ? (error.body || error.message) : (error.message || 'Internal error');
      reply.raw.write(`data: ${JSON.stringify({ error: msg, code: status })}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      try { await poolManager.releaseLock(cred.credentialId, user.id); } catch {}
    }
  }
}
