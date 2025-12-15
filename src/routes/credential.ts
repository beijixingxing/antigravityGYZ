import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { CredentialService } from '../services/CredentialService';
import { CredentialPoolManager } from '../services/CredentialPoolManager';
import { z } from 'zod';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const credentialService = new CredentialService();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

const UploadSchema = z.object({
  json_content: z.string().min(1),
  require_v3: z.boolean().optional()
});

export default async function credentialRoutes(fastify: FastifyInstance) {

  // Auth Middleware
  fastify.addHook('preHandler', async (req, reply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw { statusCode: 401, message: 'Unauthorized' };
    }
    const token = authHeader.replace('Bearer ', '');
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.user = decoded;
    } catch (e) {
      throw { statusCode: 401, message: 'Invalid Token' };
    }
  });

  // GET /api/credentials (List my credentials)
  fastify.get('/', async (req, reply) => {
    const creds = await prisma.googleCredential.findMany({
      where: { owner_id: req.user!.id }, // Return all (including DEAD)
      select: { id: true, created_at: true, status: true, fail_count: true, supports_v3: true, google_email: true }
    });
    return creds;
  });


  // POST /api/credentials (Upload)
  fastify.post('/', async (req, reply) => {
    try {
      const body = UploadSchema.parse(req.body);
      const result = await credentialService.uploadAndVerify(req.user!.id, body.json_content, body.require_v3);

      // Trigger Redis Sync to make it available immediately (handled inside service now? No, service calls addCredential)
      // Actually CredentialService calls poolManager.addCredential. We don't need to syncToRedis fully.
      // But wait, previous code in routes/credential.ts had `await pool.syncToRedis()`.
      // The new CredentialService code I wrote HAS `await poolManager.addCredential(result.id, supportsV3);`.
      // So we don't need to do anything here.

      return result;
    } catch (e: any) {
      req.log.error(e);
      return reply.code(400).send({ error: e.message });
    }
  });

  // DELETE /api/credentials/:id (User revoke)
  fastify.delete('/:id', async (req, reply) => {
    // ... (keep existing delete logic) ...
    const { id } = req.params as { id: string };
    const credentialId = Number(id);

    // Verify ownership
    const cred = await prisma.googleCredential.findFirst({
      where: { id: credentialId, owner_id: req.user!.id }
    });

    if (!cred) return reply.code(404).send({ error: 'Credential not found' });

    // Transaction: Hard Delete + Downgrade User
    await prisma.$transaction(async (tx) => {
      // 1. Hard Delete Credential
      await tx.googleCredential.delete({
        where: { id: credentialId }
      });

      // 2. Remove from Redis (Best effort)
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
      await redis.lrem('GLOBAL_CREDENTIAL_POOL', 0, String(credentialId));

      // 3. Check if user has other active credentials
      const count = await tx.googleCredential.count({
        where: {
          owner_id: req.user!.id,
          status: 'ACTIVE'
        }
      });

      // 4. If no active credentials left, downgrade
      if (count === 0) {
        await tx.user.update({
          where: { id: req.user!.id },
          data: { level: 0 }
        });
      }
    });

    return { success: true, message: 'Credential revoked' };
  });

  // POST /api/credentials/:id/check-v3 (Check Gemini 3.0 Support)
  fastify.post('/:id/check-v3', async (req, reply) => {
    const { id } = req.params as { id: string };
    const credentialId = Number(id);

    const cred = await prisma.googleCredential.findFirst({
      where: { id: credentialId, owner_id: req.user!.id }
    });

    if (!cred) return reply.code(404).send({ error: 'Credential not found' });

    try {
      const result = await credentialService.checkV3Support(cred);
      return { success: true, supports_v3: result.supported, error: result.error };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // POST /api/credentials/check-raw (Pre-upload Check)
  fastify.post('/check-raw', async (req, reply) => {
    try {
      const body = UploadSchema.parse(req.body);
      // Parse JSON to get details
      let parsed;
      try { parsed = JSON.parse(body.json_content); } catch (e) { throw new Error('无效的 JSON 格式'); }

      // Mock a credential object for the service check
      const credMock = {
        client_id: parsed.client_id || parsed.web?.client_id || parsed.installed?.client_id,
        client_secret: parsed.client_secret || parsed.web?.client_secret || parsed.installed?.client_secret,
        refresh_token: parsed.refresh_token,
        project_id: parsed.project_id
      };

      if (!credMock.client_id || !credMock.client_secret || !credMock.refresh_token) {
        throw new Error('缺少必要字段 (client_id, client_secret, refresh_token)');
      }

      const result = await credentialService.checkV3Support(credMock);

      // If supported is false, return the error reason so frontend can display it
      return {
        success: true,
        supports_v3: result.supported,
        error: result.error
      };

    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
