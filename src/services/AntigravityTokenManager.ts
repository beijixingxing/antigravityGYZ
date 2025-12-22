import { PrismaClient, AntigravityTokenStatus, AntigravityToken } from '@prisma/client';
import axios from 'axios';
import { ANTIGRAVITY_CONFIG } from '../config/antigravityConfig';
import { generateProjectId, generateSessionId, AntigravityTokenData } from '../utils/antigravityUtils';
import { antigravityQuotaCache } from './AntigravityQuotaCache';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const AG_LOCK_PREFIX = 'CRED_LOCK:AG:';

/**
 * Antigravity Token Manager
 * Uses database storage, supports Token rotation, refresh, and status management
 */
export class AntigravityTokenManager {
    private currentIndex: number = 0;
    private refreshLocks: Map<number, Promise<boolean>> = new Map();

    constructor() {
        this.initializeDatabase();
    }

    /**
     * Initialize database table if not exists
     */
    private async initializeDatabase() {
        try {
            // Create Enum if not exists
            await prisma.$executeRawUnsafe(`
                DO $$ BEGIN
                    CREATE TYPE "AntigravityTokenStatus" AS ENUM ('ACTIVE', 'COOLING', 'DEAD');
                EXCEPTION
                    WHEN duplicate_object THEN null;
                END $$;
            `);

            // Create Table if not exists
            await prisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS "AntigravityToken" (
                    "id" SERIAL NOT NULL,
                    "access_token" TEXT NOT NULL,
                    "refresh_token" TEXT NOT NULL UNIQUE,
                    "expires_in" INTEGER NOT NULL DEFAULT 3599,
                    "timestamp" BIGINT NOT NULL,
                    "project_id" TEXT,
                    "session_id" TEXT,
                    "email" TEXT,
                    "owner_id" INTEGER NOT NULL,
                    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
                    "status" "AntigravityTokenStatus" NOT NULL DEFAULT 'ACTIVE',
                    "fail_count" INTEGER NOT NULL DEFAULT 0,
                    "cooling_until" TIMESTAMP(3),
                    "last_used_at" TIMESTAMP(3),
                    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                    CONSTRAINT "AntigravityToken_pkey" PRIMARY KEY ("id"),
                    CONSTRAINT "AntigravityToken_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
                );
            `);

            // Create Indexes
            await prisma.$executeRawUnsafe(`
                CREATE INDEX IF NOT EXISTS "AntigravityToken_status_is_enabled_idx" ON "AntigravityToken"("status", "is_enabled");
            `);
            await prisma.$executeRawUnsafe(`
                CREATE INDEX IF NOT EXISTS "AntigravityToken_owner_id_idx" ON "AntigravityToken"("owner_id");
            `);

            console.log('[AntigravityTokenManager] Database initialized successfully (Table & Enum verified)');
        } catch (e: any) {
            console.error('[AntigravityTokenManager] Database initialization failed (Non-fatal if using migrations):', e.message);
        }
    }

    /**
     * Check if Token is expired
     */
    private isExpired(token: AntigravityToken): boolean {
        if (!token.timestamp || !token.expires_in) return true;
        const expiresAt = Number(token.timestamp) + (token.expires_in * 1000);
        return Date.now() >= expiresAt - 300000; // Refresh 5 minutes before expiry
    }

    /**
     * Refresh Token
     */
    async refreshToken(tokenId: number): Promise<boolean> {
        // Prevent concurrent refresh
        if (this.refreshLocks.has(tokenId)) {
            return this.refreshLocks.get(tokenId)!;
        }

        const refreshPromise = this._doRefreshToken(tokenId);
        this.refreshLocks.set(tokenId, refreshPromise);

        try {
            return await refreshPromise;
        } finally {
            this.refreshLocks.delete(tokenId);
        }
    }

    private async _doRefreshToken(tokenId: number): Promise<boolean> {
        const token = await prisma.antigravityToken.findUnique({ where: { id: tokenId } });
        if (!token) return false;

        console.log(`[AntigravityTokenManager] Refreshing Token #${tokenId}...`);

        try {
            const body = new URLSearchParams({
                client_id: ANTIGRAVITY_CONFIG.oauth.clientId,
                client_secret: ANTIGRAVITY_CONFIG.oauth.clientSecret,
                grant_type: 'refresh_token',
                refresh_token: token.refresh_token
            });

            const response = await axios.post(ANTIGRAVITY_CONFIG.oauth.tokenUrl, body.toString(), {
                headers: {
                    'Host': 'oauth2.googleapis.com',
                    'User-Agent': 'Go-http-client/1.1',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept-Encoding': 'gzip'
                },
                timeout: 30000
            });

            await prisma.antigravityToken.update({
                where: { id: tokenId },
                data: {
                    access_token: response.data.access_token,
                    expires_in: response.data.expires_in,
                    timestamp: BigInt(Date.now()),
                    status: AntigravityTokenStatus.ACTIVE,
                    fail_count: 0
                }
            });

            console.log(`[AntigravityTokenManager] Token #${tokenId} refreshed successfully`);
            return true;
        } catch (error: any) {
            console.error(`[AntigravityTokenManager] Token #${tokenId} refresh failed:`, error.message);

            const status = error.response?.status;
            if (status === 403) {
                const graceSetting = await prisma.systemSetting.findUnique({ where: { key: 'AG_STARTUP_GRACE_MINUTES' } });
                const graceMinutes = graceSetting ? parseInt(graceSetting.value || '10', 10) : 10;
                const appStartedAt = (global as any).__appStartedAt as number | undefined;
                const withinGrace = appStartedAt ? (Date.now() - appStartedAt) < (graceMinutes * 60 * 1000) : false;
                if (withinGrace) {
                    console.warn(`[AntigravityTokenManager] Within startup grace (${graceMinutes}m). Mark token #${tokenId} cooling instead of dead`);
                    await this.markAsCooling(tokenId, graceMinutes * 60 * 1000);
                } else {
                    await this.markAsDead(tokenId);
                }
            } else {
                await prisma.antigravityToken.update({
                    where: { id: tokenId },
                    data: { fail_count: { increment: 1 } }
                });
            }
            return false;
        }
    }

    /**
     * Get available Token (优化轮询：优先选择最久未使用的 Token)
     */
    async getToken(opts?: { group?: 'claude' | 'gemini3', modelId?: string }, userId?: number, ttlMs: number = 30000): Promise<AntigravityTokenData | null> {
        const now = new Date();
        const minInterval = 2000; // 同一 Token 最少间隔 2 秒

        // 先检查并恢复冷却过期的凭证
        await this.checkCoolingTokens();

        const tokens = await prisma.antigravityToken.findMany({
            where: {
                is_enabled: true,
                status: AntigravityTokenStatus.ACTIVE,
                OR: [
                    { cooling_until: null },
                    { cooling_until: { lte: now } }
                ]
            },
            take: 50 // 只取前 50 个，够用了
        });

        if (tokens.length === 0) {
            return null;
        }

        const withQuota = await Promise.all(tokens.map(async t => {
            const cached = antigravityQuotaCache.get(t.id);
            if (cached) return { t, q: cached };
            const fromRedis = await antigravityQuotaCache.getFromRedis(t.id);
            if (fromRedis) return { t, q: fromRedis };
            return { t, q: null };
        }));
        const filteredByModel = withQuota.filter(x => {
            if (!opts?.modelId) return true;
            const pm = x.q?.per_model || [];
            const m = pm.find(p => p.model_id === opts.modelId);
            if (!m) return true; // if unknown, don't exclude
            const hoursLeft = m.reset_time ? Math.max(0, (new Date(m.reset_time).getTime() - Date.now()) / 3600000) : null;
            const windowHours = typeof m.window_seconds === 'number' ? (m.window_seconds / 3600) : null;
            const effectiveHours = (hoursLeft ?? windowHours ?? 0);
            const effRemaining = typeof m.remaining === 'number' ? m.remaining : (typeof x.q?.remaining === 'number' ? x.q.remaining : 0.0);
            return effectiveHours > 0 || effRemaining > 0.01;
        });
        const normals = filteredByModel.filter(x => x.q?.classification === 'Normal' || x.q === null);
        const pros = filteredByModel.filter(x => x.q?.classification === 'Pro');
        const avgRemainingNormal = (() => {
            const vals = normals.map(x => {
                if (!x.q) return undefined;
                const pm = x.q.per_model || [];
                if (opts?.group === 'gemini3') {
                    const arr = pm.map(p => p.model_id.includes('gemini-3') ? (typeof p.remaining === 'number' ? p.remaining : null) : null)
                        .filter((v): v is number => typeof v === 'number');
                    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : (typeof x.q.remaining === 'number' ? x.q.remaining : undefined);
                } else if (opts?.group === 'claude') {
                    const arr = pm.map(p => p.model_id.includes('claude') ? (typeof p.remaining === 'number' ? p.remaining : null) : null)
                        .filter((v): v is number => typeof v === 'number');
                    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : (typeof x.q.remaining === 'number' ? x.q.remaining : undefined);
                }
                return typeof x.q.remaining === 'number' ? x.q.remaining : undefined;
            }).filter((v): v is number => typeof v === 'number');
            if (vals.length === 0) return 1;
            return vals.reduce((a, b) => a + b, 0) / vals.length;
        })();
        const candidates = avgRemainingNormal <= 0.10 ? withQuota : normals;
        const sorted = candidates
            .map(x => {
                let remaining = 0.5;
                if (x.q) {
                    const pm = x.q.per_model || [];
                    if (opts?.group === 'gemini3') {
                        const arr = pm.map(p => p.model_id.includes('gemini-3') ? (typeof p.remaining === 'number' ? p.remaining : null) : null)
                            .filter((v): v is number => typeof v === 'number');
                        remaining = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : (typeof x.q.remaining === 'number' ? x.q.remaining : 0.5);
                    } else if (opts?.group === 'claude') {
                        const arr = pm.map(p => p.model_id.includes('claude') ? (typeof p.remaining === 'number' ? p.remaining : null) : null)
                            .filter((v): v is number => typeof v === 'number');
                        remaining = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : (typeof x.q.remaining === 'number' ? x.q.remaining : 0.5);
                    } else {
                        remaining = typeof x.q.remaining === 'number' ? x.q.remaining : 0.5;
                    }
                }
                const last = x.t.last_used_at ? x.t.last_used_at.getTime() : 0;
                return { ...x, weight: remaining, last };
            })
            .sort((a, b) => {
                if (b.weight !== a.weight) return b.weight - a.weight;
                return a.last - b.last;
            });
        for (const item of sorted) {
            if (item.weight <= 0.01) continue;
            const token = item.t;
            // 跳过被其他用户持有锁的 Token
            if (userId) {
                const lockKey = `${AG_LOCK_PREFIX}${token.id}`;
                const holder = await redis.get(lockKey);
                if (holder && parseInt(holder, 10) !== userId) continue;
            }
            if (token.last_used_at) {
                const elapsed = now.getTime() - token.last_used_at.getTime();
                if (elapsed < minInterval) continue;
            }
            if (this.isExpired(token)) {
                const success = await this.refreshToken(token.id);
                if (!success) continue;
                const refreshed = await prisma.antigravityToken.findUnique({ where: { id: token.id } });
                if (!refreshed) continue;
                await prisma.antigravityToken.update({
                    where: { id: token.id },
                    data: { last_used_at: new Date() }
                }).catch(() => { });
                // 加锁
                if (userId) {
                    const ok = await this.acquireLock(token.id, userId, ttlMs);
                    if (!ok) continue;
                }
                return this.toTokenData(refreshed);
            }
            await prisma.antigravityToken.update({
                where: { id: token.id },
                data: { last_used_at: new Date() }
            }).catch(() => { });
            // 加锁
            if (userId) {
                const ok = await this.acquireLock(token.id, userId, ttlMs);
                if (!ok) continue;
            }
            return this.toTokenData(token);
        }
        const fallback = tokens
            .slice()
            .sort((a, b) => {
                const la = a.last_used_at ? a.last_used_at.getTime() : 0;
                const lb = b.last_used_at ? b.last_used_at.getTime() : 0;
                return la - lb;
            })[0];
        if (fallback) {
            if (this.isExpired(fallback)) {
                const ok = await this.refreshToken(fallback.id);
                if (ok) {
                    const r = await prisma.antigravityToken.findUnique({ where: { id: fallback.id } });
                    if (r) {
                        await prisma.antigravityToken.update({
                            where: { id: fallback.id },
                            data: { last_used_at: new Date() }
                        }).catch(() => { });
                        // 加锁
                        if (userId) {
                            const ok2 = await this.acquireLock(fallback.id, userId, ttlMs);
                            if (!ok2) return null;
                        }
                        return this.toTokenData(r);
                    }
                }
            } else {
                await prisma.antigravityToken.update({
                    where: { id: fallback.id },
                    data: { last_used_at: new Date() }
                }).catch(() => { });
                // 加锁
                if (userId) {
                    const ok3 = await this.acquireLock(fallback.id, userId, ttlMs);
                    if (!ok3) return null;
                }
                return this.toTokenData(fallback);
            }
        }
        return null;
    }

    async acquireLock(tokenId: number, userId: number, ttlMs: number = 30000): Promise<boolean> {
        const key = `${AG_LOCK_PREFIX}${tokenId}`;
        const holder = await redis.get(key);
        if (holder && parseInt(holder, 10) !== userId) return false;
        const ok = await redis.set(key, String(userId), 'PX', ttlMs, 'NX');
        if (ok === null && holder === String(userId)) {
            await redis.pexpire(key, ttlMs);
            return true;
        }
        return ok !== null;
    }

    async releaseLock(tokenId: number, userId: number): Promise<void> {
        const key = `${AG_LOCK_PREFIX}${tokenId}`;
        const holder = await redis.get(key);
        if (holder && parseInt(holder, 10) === userId) {
            await redis.del(key);
        }
    }

    async refreshAllActiveTokens(): Promise<void> {
        const tokens = await prisma.antigravityToken.findMany({
            where: { is_enabled: true, status: { in: [AntigravityTokenStatus.ACTIVE, AntigravityTokenStatus.COOLING] } },
            select: { id: true }
        });
        for (const t of tokens) {
            try {
                await this.refreshToken(t.id);
            } catch {}
        }
    }

    /**
     * Check cooling tokens
     */
    private async checkCoolingTokens(): Promise<void> {
        await prisma.antigravityToken.updateMany({
            where: {
                status: AntigravityTokenStatus.COOLING,
                cooling_until: { lte: new Date() }
            },
            data: {
                status: AntigravityTokenStatus.ACTIVE,
                cooling_until: null
            }
        });
    }

    /**
     * Mark Token as cooling (设置 COOLING 状态和冷却时间)
     */
    async markAsCooling(tokenId: number, cooldownMs: number = 60000): Promise<void> {
        console.log(`[AntigravityTokenManager] Token #${tokenId} entering cooldown for ${cooldownMs}ms`);
        await prisma.antigravityToken.update({
            where: { id: tokenId },
            data: {
                status: AntigravityTokenStatus.COOLING,
                cooling_until: new Date(Date.now() + cooldownMs)
            }
        });
    }

    /**
     * Mark Token as dead
     */
    async markAsDead(tokenId: number): Promise<void> {
        console.log(`[AntigravityTokenManager] Token #${tokenId} marked as dead`);
        await prisma.antigravityToken.update({
            where: { id: tokenId },
            data: { status: AntigravityTokenStatus.DEAD, is_enabled: false }
        });
    }

    /**
     * Add new Token (同一邮箱只能有一个凭证)
     */
    async addToken(data: {
        access_token: string;
        refresh_token: string;
        expires_in?: number;
        email?: string;
        projectId?: string;
        ownerId: number;
    }): Promise<AntigravityToken> {
        const sessionId = generateSessionId();

        // 检查邮箱是否已存在（去重 - 拒绝重复）
        if (data.email) {
            const existing = await prisma.antigravityToken.findFirst({
                where: { email: data.email }
            });

            if (existing) {
                // 邮箱已存在，拒绝重复上传
                console.log(`[AntigravityTokenManager] Email ${data.email} already exists (Token #${existing.id}), rejecting duplicate`);
                throw new Error('❌ 重复上传\n\n当前 Google 账号已经上传过反重力凭证');
            }
        }

        // 邮箱不存在，创建新凭证
        return prisma.antigravityToken.create({
            data: {
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_in: data.expires_in || 3599,
                timestamp: BigInt(Date.now()),
                project_id: data.projectId || null,
                session_id: sessionId,
                email: data.email,
                owner_id: data.ownerId,
                is_enabled: true,
                status: AntigravityTokenStatus.ACTIVE
            }
        });
    }

    /**
     * Check if user has uploaded any Antigravity token (and thus has access to the pool)
     * Only counts ACTIVE or COOLING tokens that are enabled.
     */
    async hasAntigravityAccess(userId: number): Promise<boolean> {
        const count = await prisma.antigravityToken.count({
            where: {
                owner_id: userId,
                is_enabled: true,
                status: { in: [AntigravityTokenStatus.ACTIVE, AntigravityTokenStatus.COOLING] }
            }
        });
        return count > 0;
    }

    /**
     * Delete Token
     */
    async deleteToken(tokenId: number): Promise<void> {
        await prisma.antigravityToken.delete({ where: { id: tokenId } });
    }

    /**
     * Update Token status
     */
    async updateToken(tokenId: number, data: { is_enabled?: boolean }): Promise<AntigravityToken> {
        return prisma.antigravityToken.update({
            where: { id: tokenId },
            data
        });
    }

    /**
     * Get all tokens (internal use)
     */
    async getAllTokens(): Promise<any[]> {
        const tokens = await prisma.antigravityToken.findMany({
            orderBy: { id: 'asc' }
        });
        return tokens.map(t => ({
            id: t.id,
            refresh_token: t.refresh_token,
            is_enabled: t.is_enabled
        }));
    }

    /**
     * Get Token list with pagination, sorting, and optional status filter
     */
    async getTokenList(
        page: number = 1,
        limit: number = 10,
        sortBy: string = 'id',
        order: 'asc' | 'desc' = 'asc',
        status?: string
    ): Promise<{ tokens: any[], total: number }> {
        const skip = (page - 1) * limit;
        const orderBy: any = {};

        // Handle sorting
        if (sortBy === 'total_used') {
            orderBy.total_used = order;
        } else {
            orderBy.id = order;
        }

        let whereClause: any = {};

        // Handle DUPLICATE filter - find emails that appear more than once
        if (status === 'DUPLICATE') {
            const duplicates = await prisma.$queryRaw<{ email: string; count: bigint }[]>`
                SELECT email, COUNT(*) as count
                FROM "AntigravityToken"
                WHERE email IS NOT NULL AND email != ''
                GROUP BY email
                HAVING COUNT(*) > 1
            `;
            const duplicateEmails = duplicates.map(d => d.email);

            if (duplicateEmails.length === 0) {
                return { tokens: [], total: 0 };
            }

            whereClause = { email: { in: duplicateEmails } };
        }

        const [total, tokens] = await prisma.$transaction([
            prisma.antigravityToken.count({ where: whereClause }),
            prisma.antigravityToken.findMany({
                where: whereClause,
                skip,
                take: limit,
                orderBy: status === 'DUPLICATE' ? [{ email: 'asc' }, orderBy] : orderBy,
                include: {
                    owner: {
                        select: {
                            email: true,
                            discordId: true,
                            discordUsername: true,
                            discordAvatar: true
                        }
                    }
                }
            })
        ]);

        const mappedTokens = tokens.map(t => ({
            id: t.id,
            access_token_suffix: t.access_token ? '...' + t.access_token.slice(-8) : 'N/A',
            refresh_token: t.refresh_token,
            project_id: t.project_id,
            email: t.email,
            is_enabled: t.is_enabled,
            status: t.status,
            total_used: t.total_used,
            expires_at: t.timestamp && t.expires_in
                ? new Date(Number(t.timestamp) + t.expires_in * 1000).toISOString()
                : null,
            last_used_at: t.last_used_at,
            created_at: t.created_at,
            // Owner info with Discord
            owner_email: (t as any).owner?.email || null,
            owner_discord_id: (t as any).owner?.discordId || null,
            owner_discord_username: (t as any).owner?.discordUsername || null,
            owner_discord_avatar: (t as any).owner?.discordAvatar || null
        }));

        return { tokens: mappedTokens, total };
    }

    /**
     * Get Token list by owner
     */
    async getTokenListByOwner(ownerId: number): Promise<any[]> {
        const tokens = await prisma.antigravityToken.findMany({
            where: { owner_id: ownerId },
            orderBy: { id: 'asc' }
        });
        return tokens.map(t => ({
            id: t.id,
            email: t.email,
            project_id: t.project_id,
            is_enabled: t.is_enabled,
            status: t.status,
            created_at: t.created_at
        }));
    }

    /**
     * Get statistics
     */
    async getStats(): Promise<{ total: number; active: number; cooling: number; dead: number }> {
        const [total, active, cooling, dead] = await Promise.all([
            prisma.antigravityToken.count(),
            prisma.antigravityToken.count({ where: { status: AntigravityTokenStatus.ACTIVE, is_enabled: true } }),
            prisma.antigravityToken.count({ where: { status: AntigravityTokenStatus.COOLING } }),
            prisma.antigravityToken.count({ where: { status: AntigravityTokenStatus.DEAD } })
        ]);
        return { total, active, cooling, dead };
    }

    private toTokenData(token: AntigravityToken): AntigravityTokenData {
        return {
            id: token.id,
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_in: token.expires_in,
            timestamp: token.timestamp,
            project_id: token.project_id,
            session_id: token.session_id
        };
    }
}

export const antigravityTokenManager = new AntigravityTokenManager();
