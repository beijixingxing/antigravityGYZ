import cron from 'node-cron';
import { CredentialStatus } from '@prisma/client';
import axios from 'axios';
import { AntigravityService } from './AntigravityService';
import { antigravityQuotaCache } from './AntigravityQuotaCache';
import { redis } from '../utils/redis';
import { prisma } from '../utils/prisma';
import { CredentialService } from './CredentialService';
const POOL_KEY = 'GLOBAL_CREDENTIAL_POOL';
const POOL_KEY_V3 = 'GLOBAL_CREDENTIAL_POOL_V3';

export class CronService {
    constructor() {
        this.initJobs();
    }

    private initJobs() {
        // 1. Daily Quota Reset
        // Schedule task for 00:00 every day (UTC+8)
        cron.schedule('0 0 * * *', async () => {
            console.log(`[CronService] Starting daily quota reset at ${new Date().toISOString()}...`);
            await this.resetDailyQuotas();
        }, {
            scheduled: true,
            timezone: "Asia/Shanghai"
        });

        // 2. Cooled Credentials Restoration
        // Run every 10 minutes to check if any cooling period has expired
        cron.schedule('*/10 * * * *', async () => {
            await this.restoreCooledCredentials();
        });

        // 3. Google Credential Health Check (Email refresh)
        // Run at 03:00 every day (Asia/Shanghai)
        cron.schedule('0 3 * * *', async () => {
            console.log(`[CronService] Starting GoogleCredential health check at ${new Date().toISOString()}...`);
            await this.checkCredentialHealth();
            console.log(`[CronService] Starting AntigravityToken health check at ${new Date().toISOString()}...`);
            await this.checkAntigravityTokenHealth();
        }, {
            scheduled: true,
            timezone: "Asia/Shanghai"
        });

        // 4. Antigravity Quotas Full Refresh
        // Run every 30 minutes for full refresh with high concurrency
        cron.schedule('*/30 * * * *', async () => {
            console.log(`[CronService] Starting full Antigravity quotas refresh at ${new Date().toISOString()}...`);
            await this.refreshAntigravityQuotasFull();
        }, {
            scheduled: true,
            timezone: "Asia/Shanghai"
        });

        console.log('[CronService] Jobs scheduled: Daily Quota Reset (00:00 UTC+8), Cooling Restoration (every 10m), Credential Health Check (03:00 UTC+8), Antigravity Quotas Refresh (every 30m).');
    }

    /**
     * Resets 'today_used' to 0 for ALL users.
     */
    async resetDailyQuotas() {
        try {
            const result = await prisma.user.updateMany({
                data: {
                    today_used: 0,
                },
            });
            console.log(`[CronService] Daily reset complete. Reset ${result.count} users.`);
        } catch (error) {
            console.error('[CronService] Failed to reset daily quotas:', error);
        }
    }

    /**
     * Checks for credentials that have passed their cooling period and reactivates them.
     */
    async restoreCooledCredentials() {
        try {
            const now = new Date();

            // Find expired cooling credentials
            const cooledCreds = await prisma.googleCredential.findMany({
                where: {
                    status: CredentialStatus.COOLING,
                    cooling_expires_at: {
                        lte: now
                    }
                }
            });

            if (cooledCreds.length === 0) return;

            console.log(`[CronService] Found ${cooledCreds.length} credentials ready to be restored.`);

            // 批量更新数据库和Redis
            // 1. 先更新所有数据库记录
            const updatedCreds = await Promise.all(
                cooledCreds.map(cred => 
                    prisma.googleCredential.update({
                        where: { id: cred.id },
                        data: {
                            status: CredentialStatus.ACTIVE,
                            cooling_expires_at: null,
                            fail_count: 0 // Reset fail count on restoration
                        }
                    })
                )
            );
            
            // 2. 使用批量操作将所有凭证ID添加到Redis
            const credentialIds = updatedCreds.map(cred => String(cred.id));
            if (credentialIds.length > 0) {
                await redis.rpush(POOL_KEY, ...credentialIds);
                console.log(`[CronService] Restored ${credentialIds.length} credentials to ACTIVE pool.`);
            }

        } catch (error) {
            console.error('[CronService] Failed to restore cooled credentials:', error);
        }
    }

    /**
     * Health check for Google credentials via model call (gemini-2.5-flash).
     * Strategy:
     * - Serial execution with Jitter to prevent 429.
     * - 使用凭证自身 token 调用模型；仅当模型调用返回 400/403 时标记 DEAD。
     * - Ignore temporary errors (429, 5xx, timeouts).
     */
    async checkCredentialHealth() {
        try {
            const creds = await prisma.googleCredential.findMany({
                where: {
                    status: {
                        in: [CredentialStatus.ACTIVE, CredentialStatus.COOLING, CredentialStatus.VALIDATING]
                    }
                },
                select: {
                    id: true,
                    client_id: true,
                    client_secret: true,
                    refresh_token: true,
                    fail_count: true
                }
            });

            if (creds.length === 0) {
                console.log('[CronService] No credentials to health-check.');
                return;
            }

            console.log(`[CronService] Running health check for ${creds.length} credentials (Serial+Jitter)...`);
            let skipped = 0;
            let dead = 0;
            let warnings = 0;

            // STRICT SERIAL EXECUTION
            const cs = new CredentialService();
            for (const cred of creds) {
                // Smart Jitter: 500ms + random(0-500ms) = 500ms ~ 1000ms interval
                const jitter = 500 + Math.floor(Math.random() * 500);
                await new Promise(r => setTimeout(r, jitter));

                try {
                    const tokenRes = await axios.post(
                        process.env.GOOGLE_OAUTH_URL || 'https://oauth2.googleapis.com/token',
                        {
                            client_id: cred.client_id,
                            client_secret: cred.client_secret,
                            refresh_token: cred.refresh_token,
                            grant_type: 'refresh_token'
                        },
                        {
                            headers: { 'Content-Type': 'application/json' },
                            timeout: 30000
                        }
                    );

                    const accessToken = tokenRes.data?.access_token;
                    if (!accessToken) {
                        // Very rare case: 200 OK but no token? treat as temp fail or single strike
                        console.warn(`[CronService] Credential ${cred.id} no access_token. Skipping.`);
                        continue;
                    }

                    // 用凭证 token 调模型；只对 400/403 判死，429/5xx 视为暂时
                    try {
                        await cs.verifyCloudCodeAccess(accessToken, undefined, 'gemini-2.5-flash', true);
                        // SUCCESS: Reset fail_count to 0
                        if (cred.fail_count > 0) {
                            await prisma.googleCredential.update({
                                where: { id: cred.id },
                                data: { fail_count: 0 }
                            });
                        }
                    } catch (e: any) {
                        const status = e?.statusCode;
                        const msg = e?.message || '';

                        if (status === 400 || status === 403) {
                            console.error(`[CronService] Credential ${cred.id} model access ${status}, marking DEAD.`);
                            await this.markCredentialDead(cred.id, `Model access failed (${status})`);
                            dead++;
                        } else {
                            console.log(`[CronService] Credential ${cred.id} ignored error: ${status || msg}`);
                            skipped++;
                        }
                        continue;
                    }
                } catch (e: any) {
                    const status = e.response?.status;
                    const msg = e.message || '';
                    const msgLower = msg.toLowerCase();

                    // Temporary errors (429, 5xx, Network)
                    const isTemporary = status === 429 || status === 503 || status === 502 || status === 500 ||
                        msgLower.includes('timeout') || msgLower.includes('etimedout') ||
                        msgLower.includes('econnreset') || msgLower.includes('network');

                    if (isTemporary) {
                        console.log(`[CronService] Credential ${cred.id} ignored temporary error: ${status || msg}`);
                        // Anti-429: Wait extra time
                        await new Promise(r => setTimeout(r, 2000));
                        skipped++;
                        continue;
                    }

                    // 其他错误（如 invalid_grant 400）保守跳过，不直接判死
                    console.log(`[CronService] Credential ${cred.id} ignored unknown error: ${status || msg}`);
                    skipped++;
                }
            }

            if (dead > 0 || skipped > 0 || warnings > 0) {
                console.log(`[CronService] Health Check: ${dead} DEAD, ${warnings} Warning (Strike 1), ${skipped} Skipped.`);
            }
        } catch (error) {
            console.error('[CronService] Failed to run credential health check:', error);
        }
    }

    private async markCredentialDead(credentialId: number, reason: string) {
        try {
            console.warn(`[CronService] Marking credential ${credentialId} as DEAD (${reason})`);
            await prisma.googleCredential.update({
                where: { id: credentialId },
                data: {
                    status: CredentialStatus.DEAD,
                    is_active: false
                }
            });

            await redis.lrem(POOL_KEY, 0, String(credentialId));
            await redis.lrem(POOL_KEY_V3, 0, String(credentialId));
        } catch (e) {
            console.error(`[CronService] Failed to mark credential ${credentialId} as DEAD:`, (e as any).message);
        }
    }

    /**
     * Health check for Antigravity tokens by sending a simple "Hi" to a supported Antigravity model.
     * Only delete tokens that fail with 403 (permission denied) errors.
     * Ignore temporary errors like 429, 503, 400, network timeouts, etc.
     */
    /**
     * Health check for Antigravity tokens by sending a simple "Hi" to a supported Antigravity model.
     * Strategy:
     * - Serial execution + Smart Jitter (avg 600ms) to prevent 429.
     * - 2-Strike Rule: Only delete token if 403 occurs twice consecutively.
     * - Ignore 429/5xx completely.
     */
    async checkAntigravityTokenHealth() {
        try {
            const tokens = await prisma.antigravityToken.findMany({
                where: { is_enabled: true, status: 'ACTIVE' },
                select: {
                    id: true,
                    access_token: true,
                    refresh_token: true,
                    expires_in: true,
                    timestamp: true,
                    project_id: true,
                    session_id: true,
                    owner_id: true,
                    email: true,
                    fail_count: true
                }
            });

            if (tokens.length === 0) {
                console.log('[CronService] No Antigravity tokens to health-check.');
                return;
            }

            console.log(`[CronService] Running Antigravity health check for ${tokens.length} tokens (Serial+Jitter)...`);
            let removed = 0;
            let skipped = 0;
            let warnings = 0;

            // STRICT SERIAL EXECUTION
            for (const t of tokens) {
                // Smart Jitter: 200ms + random(0-800ms) = 200ms ~ 1000ms
                const jitter = 200 + Math.floor(Math.random() * 800);
                await new Promise(r => setTimeout(r, jitter));

                const tokenData = {
                    id: t.id,
                    access_token: t.access_token,
                    refresh_token: t.refresh_token,
                    expires_in: t.expires_in,
                    timestamp: t.timestamp,
                    project_id: t.project_id,
                    session_id: t.session_id
                };

                try {
                    // 使用 Antigravity 支持的模型进行健康检查 (claude-sonnet-4-5)
                    await AntigravityService.generateResponse(
                        [{ role: 'user', content: 'Hi' }],
                        'claude-sonnet-4-5',
                        { max_tokens: 16, temperature: 0.1 },
                        undefined,
                        tokenData
                    );

                    // SUCCESS: Reset fail_count if needed
                    if (t.fail_count > 0) {
                        await prisma.antigravityToken.update({
                            where: { id: t.id },
                            data: { fail_count: 0 }
                        }).catch(() => { });
                    }

                } catch (e: any) {
                    const msg = e?.message || '';
                    const status = (e as any).statusCode ?? e.response?.status;

                    const is429 = msg.includes('429');
                    const is5xx = msg.includes('503') || msg.includes('502') || msg.includes('500');
                    const is403 = status === 403;

                    if (is429 || is5xx) {
                        // 临时性错误，跳过且增加避让时间
                        console.log(`[CronService] Antigravity token ${t.id} ignored 429/5xx error.`);
                        await new Promise(r => setTimeout(r, 2000)); // Extra 2s backoff
                        skipped++;
                        continue;
                    }

                    if (is403) {
                        if (t.fail_count >= 1) {
                            // Strike 2 -> DEAD
                            console.error(`[CronService] Antigravity token ${t.id} 403 permission denied x2 (Strike 2). Removing.`);
                            try {
                                await prisma.antigravityToken.delete({ where: { id: t.id } });
                                removed++;
                                // Log usage failure
                                await prisma.usageLog.create({
                                    data: { user_id: t.owner_id, credential_id: null, status_code: 470 }
                                }).catch(() => { });
                            } catch (delErr) { }
                        } else {
                            // Strike 1 -> Warning + Increment
                            console.warn(`[CronService] Antigravity token ${t.id} 403 permission denied (Strike 1).`);
                            await prisma.antigravityToken.update({
                                where: { id: t.id },
                                data: { fail_count: { increment: 1 } }
                            }).catch(() => { });
                            warnings++;
                        }
                        continue;
                    }

                    // Other errors (400, timeouts) -> Just skip/log, don't kill
                    console.log(`[CronService] Antigravity token ${t.id} skipped due to other error: ${status} ${msg.substring(0, 50)}`);
                    skipped++;
                }
            }

            if (removed > 0 || skipped > 0 || warnings > 0) {
                console.log(`[CronService] Antigravity health check: ${removed} DEAD, ${warnings} Warnings, ${skipped} Skipped.`);
            }
        } catch (error) {
            console.error('[CronService] Failed to run Antigravity token health check:', error);
        }
    }



    /**
     * Full refresh of all Antigravity token quotas with high concurrency.
     * Runs every 30 minutes as scheduled by initJobs.
     * Publishes progress events to Redis channel for SSE monitoring.
     */
    async refreshAntigravityQuotasFull() {
        const REFRESH_CHANNEL = 'AG_QUOTA_REFRESH_PROGRESS';

        try {
            const tokens = await prisma.antigravityToken.findMany({
                where: { is_enabled: true, status: 'ACTIVE' },
                select: { id: true, access_token: true, refresh_token: true, expires_in: true, timestamp: true, project_id: true, email: true }
            });

            if (tokens.length === 0) {
                console.log('[CronService] No active tokens to refresh.');
                await redis.publish(REFRESH_CHANNEL, JSON.stringify({ type: 'done', total: 0, ok: 0, skipped: 0, duration: '0' }));
                return;
            }

            const { pLimit } = await import('../utils/concurrency');
            const limit = pLimit(30); // 30 concurrent requests for speed

            let ok = 0, skipped = 0, completed = 0;
            const total = tokens.length;
            const startTime = Date.now();

            // Publish start event
            await redis.publish(REFRESH_CHANNEL, JSON.stringify({ type: 'start', total }));

            await Promise.all(tokens.map(t => limit(async () => {
                const tokenData = {
                    id: t.id,
                    access_token: t.access_token,
                    refresh_token: t.refresh_token,
                    expires_in: t.expires_in,
                    timestamp: t.timestamp,
                    project_id: t.project_id,
                    session_id: String(t.id)
                };

                let status = 'ok';
                let classification: string | null = null;
                let errorMsg: string | null = null;

                try {
                    const result = await antigravityQuotaCache.refreshToken(tokenData as any, { waitForRateLimit: true });
                    classification = result?.classification || null;
                    ok++;
                } catch (e: any) {
                    status = 'error';
                    errorMsg = e.message || String(e);
                    skipped++;
                }

                completed++;

                // Publish progress event every 5 tokens to reduce overhead
                if (completed % 5 === 0 || completed === total) {
                    await redis.publish(REFRESH_CHANNEL, JSON.stringify({
                        type: 'progress',
                        current: completed,
                        total,
                        lastToken: { id: t.id, email: t.email, status, classification, error: errorMsg }
                    }));
                }
            })));

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[CronService] Full quotas refresh completed: ok=${ok}, skipped=${skipped}, total=${tokens.length}, duration=${duration}s`);

            // Publish done event
            await redis.publish(REFRESH_CHANNEL, JSON.stringify({ type: 'done', total, ok, skipped, duration }));
        } catch (err) {
            console.error('[CronService] Failed to refresh Antigravity quotas:', (err as any)?.message || err);
            await redis.publish(REFRESH_CHANNEL, JSON.stringify({ type: 'error', message: (err as any)?.message || 'Unknown error' }));
        }
    }
}
