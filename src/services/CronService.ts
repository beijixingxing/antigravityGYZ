import cron from 'node-cron';
import { PrismaClient, CredentialStatus } from '@prisma/client';
import Redis from 'ioredis';
import axios from 'axios';
import { AntigravityService } from './AntigravityService';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
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

        console.log('[CronService] Jobs scheduled: Daily Quota Reset (00:00 UTC+8), Cooling Restoration (every 10m), Credential Health Check (03:00 UTC+8).');
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

            for (const cred of cooledCreds) {
                // Transaction: Update DB -> Push to Redis
                // Note: Redis push isn't part of Prisma transaction, so we do it after.

                await prisma.googleCredential.update({
                    where: { id: cred.id },
                    data: {
                        status: CredentialStatus.ACTIVE,
                        cooling_expires_at: null,
                        fail_count: 0 // Reset fail count on restoration
                    }
                });

                await redis.rpush(POOL_KEY, String(cred.id));
                console.log(`[CronService] Restored Credential ${cred.id} to ACTIVE pool.`);
            }

        } catch (error) {
            console.error('[CronService] Failed to restore cooled credentials:', error);
        }
    }

    /**
     * Health check for Google credentials via email refresh.
     * Only mark as DEAD for permanent errors (403, 401, invalid_grant).
     * Ignore temporary errors like network timeouts, 5xx, 429, etc.
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
                    owner_id: true,
                    google_email: true
                }
            });

            if (creds.length === 0) {
                console.log('[CronService] No credentials to health-check.');
                return;
            }

            console.log(`[CronService] Running health check for ${creds.length} credentials...`);
            let skipped = 0;
            let dead = 0;

            for (const cred of creds) {
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
                        await this.markCredentialDead(cred.id, 'No access_token when refreshing');
                        dead++;
                        continue;
                    }

                    try {
                        const userInfo = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
                            headers: {
                                'Host': 'www.googleapis.com',
                                'User-Agent': 'Go-http-client/1.1',
                                'Authorization': `Bearer ${accessToken}`,
                                'Accept-Encoding': 'gzip'
                            },
                            timeout: 30000
                        });

                        const email = userInfo.data?.email;
                        if (!email) {
                            console.warn(`[CronService] Credential ${cred.id} userinfo has no email, treating as dead.`);
                            await this.markCredentialDead(cred.id, 'No email in userinfo');
                            dead++;
                            continue;
                        }

                        if (!cred.google_email || cred.google_email !== email) {
                            await prisma.googleCredential.update({
                                where: { id: cred.id },
                                data: { google_email: email }
                            });
                        }
                    } catch (e: any) {
                        const status = e.response?.status;
                        const msg = e.message || '';
                        const msgLower = msg.toLowerCase();
                        const isTemporary = status === 429 || status === 503 || status === 502 || status === 500 ||
                            msgLower.includes('timeout') || msgLower.includes('etimedout') ||
                            msgLower.includes('econnreset') || msgLower.includes('enotfound') ||
                            msgLower.includes('econnrefused') || msgLower.includes('network');
                        if (isTemporary) {
                            console.log(`[CronService] Credential ${cred.id} userinfo fetch skipped due to temporary error: ${msg.substring(0, 100)}`);
                            skipped++;
                            continue;
                        }
                        if (status === 403) {
                            console.error(`[CronService] Credential ${cred.id} userinfo fetch failed:`, e.response?.data || e.message);
                            await this.markCredentialDead(cred.id, 'Failed to fetch userinfo (403)');
                            dead++;
                            continue;
                        }
                        console.log(`[CronService] Credential ${cred.id} userinfo fetch skipped due to non-403 error: ${status || 'unknown'}`);
                        skipped++;
                        continue;
                    }
                } catch (e: any) {
                    // 检查 Token 刷新的错误类型
                    const status = e.response?.status;
                    const errorCode = e.response?.data?.error;
                    const msg = e.message || '';
                    const msgLower = msg.toLowerCase();

                    const isPermanent = status === 403;

                    // 临时性错误：网络问题、5xx、429
                    const isTemporary = status === 429 || status === 503 || status === 502 || status === 500 ||
                        msgLower.includes('timeout') || msgLower.includes('etimedout') ||
                        msgLower.includes('econnreset') || msgLower.includes('enotfound') ||
                        msgLower.includes('econnrefused') || msgLower.includes('network');

                    if (isTemporary) {
                        console.log(`[CronService] Credential ${cred.id} token refresh skipped due to temporary error: ${msg.substring(0, 100)}`);
                        skipped++;
                        continue;
                    }

                    if (isPermanent) {
                        console.error(`[CronService] Credential ${cred.id} token refresh failed (permanent):`, e.response?.data || e.message);
                        await this.markCredentialDead(cred.id, `Token refresh failed: ${errorCode || status}`);
                        dead++;
                        continue;
                    }

                    // 其他未知错误，跳过，避免误删
                    console.log(`[CronService] Credential ${cred.id} token refresh skipped due to unknown error: ${msg.substring(0, 100)}`);
                    skipped++;
                    continue;
                }
            }

            if (dead > 0 || skipped > 0) {
                console.log(`[CronService] CLI credential health check completed: ${dead} marked dead, ${skipped} skipped due to temporary errors.`);
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
                    email: true
                }
            });

            if (tokens.length === 0) {
                console.log('[CronService] No Antigravity tokens to health-check.');
                return;
            }

            console.log(`[CronService] Running Antigravity health check for ${tokens.length} tokens...`);
            let removed = 0;
            let skipped = 0;

            for (const t of tokens) {
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
                } catch (e: any) {
                    const msg = e?.message || '';
                    const msgLower = msg.toLowerCase();

                    // 检查是否为临时性/可恢复的错误，这些错误应该跳过，不删除凭证
                    const is429 = msg.includes('429');                    // 限流
                    const is503 = msg.includes('503');                    // 服务不可用
                    const is502 = msg.includes('502');                    // 网关错误
                    const is500 = msg.includes('500');                    // 服务器内部错误
                    const is400 = msg.includes('400');                    // 请求错误（可能是临时问题）
                    const isTimeout = msgLower.includes('timeout') || msgLower.includes('etimedout') || msgLower.includes('econnreset');
                    const isNetworkError = msgLower.includes('network') || msgLower.includes('enotfound') || msgLower.includes('econnrefused');

                    const status = (e as any).statusCode ?? e.response?.status;
                    const is403 = status === 403;

                    if (is429 || is503 || is502 || is500 || is400 || isTimeout || isNetworkError) {
                        // 临时性错误，跳过这个凭证，下次再检查
                        skipped++;
                        console.log(`[CronService] Antigravity token ${t.id} (${t.email || 'unknown'}) skipped due to temporary error: ${status || ''} ${msg.substring(0, 100)}`);
                        continue;
                    }

                    if (!is403) {
                        // 其他未知错误，也跳过，避免误删
                        skipped++;
                        console.log(`[CronService] Antigravity token ${t.id} (${t.email || 'unknown'}) skipped due to non-403 error: ${status || ''} ${msg.substring(0, 100)}`);
                        continue;
                    }

                    // 403 权限错误：删除无效凭证并记录日志
                    try {
                        await prisma.antigravityToken.delete({ where: { id: t.id } });
                        removed++;
                    } catch (delErr) {
                        console.error(`[CronService] Failed to delete Antigravity token ${t.id}:`, (delErr as any).message);
                    }

                    try {
                        await prisma.usageLog.create({
                            data: {
                                user_id: t.owner_id,
                                credential_id: null,
                                status_code: 470
                            }
                        });
                    } catch { }

                    console.warn(`[CronService] Antigravity token ${t.id} (${t.email || 'unknown'}) removed due to 403 permission denied.`);
                }
            }

            if (removed > 0 || skipped > 0) {
                console.log(`[CronService] Antigravity health check completed: ${removed} removed, ${skipped} skipped due to temporary errors.`);
            }
        } catch (error) {
            console.error('[CronService] Failed to run Antigravity token health check:', error);
        }
    }
}
