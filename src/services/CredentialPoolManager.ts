import Redis from 'ioredis';
import { PrismaClient, CredentialStatus } from '@prisma/client';
import { request } from 'undici';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const POOL_KEY = 'GLOBAL_CREDENTIAL_POOL';
const POOL_KEY_V3 = 'GLOBAL_CREDENTIAL_POOL_V3';
const COOLING_SET_PREFIX = 'COOLING:';

export class CredentialPoolManager {
  constructor() {
    this.syncToRedis().catch(console.error);
  }

  /**
   * Sync ACTIVE credentials from DB to Redis List
   */
  async syncToRedis() {
    console.log('[PoolManager] Syncing credentials to Redis...');
    
    await redis.del(POOL_KEY);
    await redis.del(POOL_KEY_V3);

    const activeCreds = await prisma.googleCredential.findMany({
      where: { status: CredentialStatus.ACTIVE },
      select: { id: true, supports_v3: true }
    });

    if (activeCreds.length === 0) {
      console.warn('[PoolManager] No ACTIVE credentials found.');
      return;
    }

    const allIds = activeCreds.map(c => c.id);
    const v3Ids = activeCreds.filter(c => c.supports_v3).map(c => c.id);

    await redis.rpush(POOL_KEY, ...allIds.map(String));
    if (v3Ids.length > 0) {
        await redis.rpush(POOL_KEY_V3, ...v3Ids.map(String));
    }
    
    console.log(`[PoolManager] Synced ${allIds.length} to GLOBAL, ${v3Ids.length} to V3`);
  }

  /**
   * Add a new credential to the pool immediately.
   */
  async addCredential(credentialId: number, supportsV3: boolean = false) {
    await redis.lpush(POOL_KEY, String(credentialId));
    if (supportsV3) {
        await redis.lpush(POOL_KEY_V3, String(credentialId));
    }
    console.log(`[PoolManager] Added credential ${credentialId} to pool (V3: ${supportsV3}).`);
  }

  /**
   * Get a valid credential via Round-Robin.
   * Iterates through the list to find a working one.
   */
  async getRoundRobinCredential(type: 'GLOBAL' | 'V3' = 'GLOBAL'): Promise<{ credentialId: number; accessToken: string; projectId: string } | null> {
    const targetPool = type === 'V3' ? POOL_KEY_V3 : POOL_KEY;

    // 1. Get pool size to determine max attempts (prevent infinite loop)
    const poolSize = await redis.llen(targetPool);
    
    if (poolSize === 0) {
        // Try sync if empty (lazy sync might help if redis was flushed)
        await this.syncToRedis();
        if (await redis.llen(targetPool) === 0) {
            console.warn(`[PoolManager] ${type} Pool is empty after sync.`);
            return null;
        }
    }

    // We will try up to 'current pool size' + buffer times to find a valid one.
    const maxAttempts = (await redis.llen(targetPool)) + 2; 

    for (let i = 0; i < maxAttempts; i++) {
        // Rotate: RPOPLPUSH
        const credentialIdStr = await redis.rpoplpush(targetPool, targetPool);
        
        if (!credentialIdStr) {
             await this.syncToRedis();
             continue;
        }

        const credentialId = parseInt(credentialIdStr, 10);

        // Load & Validate
        try {
            const cred = await this.loadAndRefreshToken(credentialId);
            if (cred) {
                return cred;
            }
        } catch (error: any) {
             console.warn(`[PoolManager] Unexpected error loading cred ${credentialId}: ${error.message}`);
        }
    }

    console.error(`[PoolManager] Exhausted all credentials in ${type} pool without success.`);
    return null;
  }

  /**
   * Load credential, check expiry, refresh if needed (5 min buffer).
   * Mirrors CredentialManager._load_current_credential & _should_refresh_token
   */
  private async loadAndRefreshToken(credentialId: number): Promise<{ credentialId: number; accessToken: string; projectId: string } | null> {
    const cred = await prisma.googleCredential.findUnique({
      where: { id: credentialId },
      select: { 
        id: true,
        client_id: true,
        client_secret: true,
        refresh_token: true,
        project_id: true,
        access_token: true,
        expires_at: true,
        status: true
      }
    });

    if (!cred) return null;
    if (cred.status !== CredentialStatus.ACTIVE) return null; // Should have been filtered out but double check

    // Check Expiry (5 minute buffer)
    const now = Date.now();
    const expiry = cred.expires_at ? cred.expires_at.getTime() : 0;
    const isExpired = !cred.access_token || (expiry - now < 300 * 1000); // < 300s (5 mins)

    if (isExpired) {
        console.log(`[PoolManager] Token expired or missing for ID ${credentialId}, refreshing...`);
        try {
            const { accessToken, expiresIn } = await this.refreshGoogleToken(
                cred.refresh_token.trim(),
                cred.client_id.trim(),
                cred.client_secret.trim()
            );

            // Update DB
            const newExpiry = new Date(Date.now() + (expiresIn * 1000));
            await prisma.googleCredential.update({
                where: { id: credentialId },
                data: {
                    access_token: accessToken,
                    expires_at: newExpiry,
                    last_validated_at: new Date()
                }
            });

            return { 
                credentialId: cred.id, 
                accessToken, 
                projectId: cred.project_id.trim() 
            };
        } catch (e: any) {
            console.error(`[PoolManager] Refresh failed for ID ${credentialId}: ${e.message}`);
            
            // Check for permanent errors (auto-ban logic from gcli2api)
            const isPermanent = this.isPermanentError(e.message, (e as any).statusCode);
            if (isPermanent) {
                await this.markAsDead(credentialId);
            }
            return null;
        }
    }

    return { 
        credentialId: cred.id, 
        accessToken: cred.access_token!, 
        projectId: cred.project_id.trim() 
    };
  }

  private async refreshGoogleToken(refreshToken: string, clientId: string, clientSecret: string): Promise<{ accessToken: string, expiresIn: number }> {
    const oauthUrl = process.env.GOOGLE_OAUTH_URL || 'https://oauth2.googleapis.com/token';
    
    const { statusCode, body } = await request(oauthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    if (statusCode !== 200) {
      const errorText = await body.text();
      const error = new Error(`Token refresh failed: ${errorText}`);
      (error as any).statusCode = statusCode;
      throw error;
    }

    const data = await body.json() as any;
    return { 
        accessToken: data.access_token, 
        expiresIn: data.expires_in // seconds
    };
  }

  /**
   * Check for permanent errors matching gcli2api logic
   */
  private isPermanentError(errMsg: string, statusCode?: number): boolean {
    if (statusCode && [400, 401, 403].includes(statusCode)) return true;
    
    const patterns = [
        "invalid_grant",
        "refresh_token_expired",
        "invalid_refresh_token",
        "unauthorized_client",
        "access_denied"
    ];
    return patterns.some(p => errMsg.toLowerCase().includes(p));
  }

  async markAsCooling(credentialId: number, resetTimestamp?: number) {
    console.warn(`[PoolManager] Credential ${credentialId} hit 429. Moving to cooling.`);
    
    let resetTime: Date;

    if (resetTimestamp) {
        resetTime = new Date(resetTimestamp);
        console.log(`[PoolManager] Using upstream quota reset time: ${resetTime.toISOString()}`);
    } else {
        // Fallback: UTC+7 next day logic
        const now = new Date();
        const utc7Now = new Date(now.getTime() + 7 * 60 * 60 * 1000);
        const utc7NextMidnight = new Date(utc7Now);
        utc7NextMidnight.setUTCHours(0, 0, 0, 0);
        utc7NextMidnight.setDate(utc7NextMidnight.getDate() + 1);
        resetTime = new Date(utc7NextMidnight.getTime() - 7 * 60 * 60 * 1000);
    }

    await prisma.googleCredential.update({
      where: { id: credentialId },
      data: {
        status: CredentialStatus.COOLING,
        cooling_expires_at: resetTime
      }
    });

    await redis.lrem(POOL_KEY, 0, String(credentialId));
    await redis.lrem(POOL_KEY_V3, 0, String(credentialId));
  }

  async markAsDead(credentialId: number) {
    console.warn(`[PoolManager] Marking credential ${credentialId} as DEAD (Auto Ban).`);
    await prisma.googleCredential.update({
      where: { id: credentialId },
      data: { 
        status: CredentialStatus.DEAD,
        is_active: false
      }
    });
    await redis.lrem(POOL_KEY, 0, String(credentialId));
    await redis.lrem(POOL_KEY_V3, 0, String(credentialId));
  }
}
