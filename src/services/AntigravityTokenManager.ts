import { PrismaClient, AntigravityTokenStatus, AntigravityToken } from '@prisma/client';
import axios from 'axios';
import { ANTIGRAVITY_CONFIG } from '../config/antigravityConfig';
import { generateProjectId, generateSessionId, AntigravityTokenData } from '../utils/antigravityUtils';

const prisma = new PrismaClient();

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
            if (status === 403 || status === 400) {
                await this.markAsDead(tokenId);
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
    async getToken(): Promise<AntigravityTokenData | null> {
        const now = new Date();
        const minInterval = 2000; // 同一 Token 最少间隔 2 秒

        // 先检查并恢复冷却过期的凭证
        await this.checkCoolingTokens();

        // 按 last_used_at 升序排序，优先使用最久未使用的 Token
        // 注意：last_used_at 为 NULL 的（从未使用）应该排在最前面
        // 只取前 50 个，提升大量凭证场景的性能
        const tokens = await prisma.antigravityToken.findMany({
            where: {
                is_enabled: true,
                status: AntigravityTokenStatus.ACTIVE,
                OR: [
                    { cooling_until: null },
                    { cooling_until: { lte: now } }
                ]
            },
            orderBy: [
                // Prisma 默认 NULL 排在最前面（NULLS FIRST），这正是我们要的
                { last_used_at: 'asc' }
            ],
            take: 50 // 只取前 50 个，够用了
        });

        if (tokens.length === 0) {
            return null;
        }

        // 尝试找一个符合间隔要求的 Token
        for (const token of tokens) {
            // 检查使用间隔
            if (token.last_used_at) {
                const elapsed = now.getTime() - token.last_used_at.getTime();
                if (elapsed < minInterval) {
                    // 这个 Token 用得太频繁，跳过
                    continue;
                }
            }

            // Check if expired
            if (this.isExpired(token)) {
                const success = await this.refreshToken(token.id);
                if (!success) continue;

                // Get refreshed token
                const refreshedToken = await prisma.antigravityToken.findUnique({ where: { id: token.id } });
                if (!refreshedToken) continue;

                // Update last used time
                await prisma.antigravityToken.update({
                    where: { id: token.id },
                    data: { last_used_at: new Date() }
                }).catch(() => { });

                return this.toTokenData(refreshedToken);
            }

            // Update last used time
            await prisma.antigravityToken.update({
                where: { id: token.id },
                data: { last_used_at: new Date() }
            }).catch(() => { });

            return this.toTokenData(token);
        }

        // 如果所有 Token 都在间隔内，退而求其次：用最久未使用的那个
        const fallbackToken = tokens[0];
        if (fallbackToken) {
            if (this.isExpired(fallbackToken)) {
                const success = await this.refreshToken(fallbackToken.id);
                if (success) {
                    const refreshedToken = await prisma.antigravityToken.findUnique({ where: { id: fallbackToken.id } });
                    if (refreshedToken) {
                        await prisma.antigravityToken.update({
                            where: { id: fallbackToken.id },
                            data: { last_used_at: new Date() }
                        }).catch(() => { });
                        return this.toTokenData(refreshedToken);
                    }
                }
            } else {
                await prisma.antigravityToken.update({
                    where: { id: fallbackToken.id },
                    data: { last_used_at: new Date() }
                }).catch(() => { });
                return this.toTokenData(fallbackToken);
            }
        }

        return null;
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
     * Add new Token
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
     */
    async hasAntigravityAccess(userId: number): Promise<boolean> {
        const count = await prisma.antigravityToken.count({
            where: { owner_id: userId }
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
     * Get Token list with pagination and sorting
     */
    async getTokenList(
        page: number = 1,
        limit: number = 10,
        sortBy: string = 'id',
        order: 'asc' | 'desc' = 'asc'
    ): Promise<{ tokens: any[], total: number }> {
        const skip = (page - 1) * limit;
        const orderBy: any = {};

        // Handle sorting
        if (sortBy === 'total_used') {
            orderBy.total_used = order;
        } else {
            orderBy.id = order;
        }

        const [total, tokens] = await prisma.$transaction([
            prisma.antigravityToken.count(),
            prisma.antigravityToken.findMany({
                skip,
                take: limit,
                orderBy
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
            created_at: t.created_at
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
