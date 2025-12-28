import { AntigravityService } from './AntigravityService';
import { AntigravityTokenData } from '../utils/antigravityUtils';
import { redis } from '../utils/redis';
import { calculateMedian, extractNumbersFromObjects, extractNumbersFromNestedData } from '../utils/arrayUtils';
import { prisma } from '../utils/prisma';

type PerModelQuota = {
  model_id: string;
  remaining: number | null;
  reset_time: string | null;
  window_seconds?: number | null;
};

type TokenQuotaSummary = {
  token_id: number;
  remaining: number | null;
  window_hours: number | null;
  classification: 'Normal' | 'Pro' | null;
  per_model: PerModelQuota[];
  fetched_at: number;
};

type RefreshOptions = {
  waitForRateLimit?: boolean;
};

class AntigravityQuotaCache {
  private cache = new Map<number, TokenQuotaSummary>();
  private ttlMs = 15 * 60 * 1000;
  // 使用共享 Redis 连接 (从 utils/redis 导入)
  private rateKey = 'AG_QCACHE_RATE';
  private fetchLockPrefix = 'AG_QCACHE_FETCH:';
  private cacheKeyPrefix = 'AG_QCACHE:';
  // 预刷新队列 (避免重复触发)
  private prefetchQueue = new Set<number>();

  private async getRateLimitPerMinute(): Promise<number> {
    try {
      const setting = await prisma.systemSetting.findUnique({ where: { key: 'QUOTA_FETCH_RATE_PER_MINUTE' } });
      const v = setting ? parseInt(setting.value || '0', 10) : 0;
      return v > 0 ? v : 120;
    } catch {
      return 120;
    }
  }
  private async withinRate(): Promise<boolean> {
    try {
      const limit = await this.getRateLimitPerMinute();
      const n = await redis.incr(this.rateKey);
      if (n === 1) {
        await redis.expire(this.rateKey, 60);
      }
      return n <= limit;
    } catch {
      return true;
    }
  }
  private async waitForRateSlot(): Promise<boolean> {
    try {
      while (true) {
        const ok = await this.withinRate();
        if (ok) return true;
        const ttl = await redis.ttl(this.rateKey);
        const waitMs = (ttl && ttl > 0 ? ttl + 1 : 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    } catch {
      return true;
    }
  }
  private async acquireFetchLock(tokenId: number, ttlMs: number): Promise<boolean> {
    try {
      const ok = await redis.set(this.fetchLockPrefix + String(tokenId), '1', 'PX', ttlMs, 'NX');
      return ok !== null;
    } catch {
      return false;
    }
  }
  private async releaseFetchLock(tokenId: number): Promise<void> {
    try { await redis.del(this.fetchLockPrefix + String(tokenId)); } catch { }
  }
  private async readRedisCache(tokenId: number): Promise<TokenQuotaSummary | null> {
    try {
      const raw = await redis.get(this.cacheKeyPrefix + String(tokenId));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj as TokenQuotaSummary;
    } catch {
      return null;
    }
  }

  /**
   * 批量从 Redis 读取多个 Token 的配额缓存 (使用 MGET)
   * @param tokenIds Token ID 数组
   * @returns Map<tokenId, TokenQuotaSummary | null>
   */
  async readRedisCacheBatch(tokenIds: number[]): Promise<Map<number, TokenQuotaSummary | null>> {
    const result = new Map<number, TokenQuotaSummary | null>();
    if (tokenIds.length === 0) return result;

    try {
      const keys = tokenIds.map(id => this.cacheKeyPrefix + String(id));
      const values = await redis.mget(...keys);
      
      for (let i = 0; i < tokenIds.length; i++) {
        const raw = values[i];
        if (raw) {
          try {
            const obj = JSON.parse(raw) as TokenQuotaSummary;
            result.set(tokenIds[i], obj);
            // 同时更新内存缓存
            this.cache.set(tokenIds[i], obj);
          } catch {
            result.set(tokenIds[i], null);
          }
        } else {
          result.set(tokenIds[i], null);
        }
      }
    } catch (e) {
      console.error('[QuotaCache] Batch read failed:', e);
      // 降级为单个读取
      for (const tokenId of tokenIds) {
        result.set(tokenId, await this.readRedisCache(tokenId));
      }
    }
    return result;
  }

  /**
   * 批量获取配额信息 (优先内存缓存 -> Redis 批量读取)
   * @param tokenIds Token ID 数组
   * @returns Map<tokenId, TokenQuotaSummary | null>
   */
  async getBatch(tokenIds: number[]): Promise<Map<number, TokenQuotaSummary | null>> {
    const result = new Map<number, TokenQuotaSummary | null>();
    const missingIds: number[] = [];

    // 1. 先检查内存缓存
    for (const tokenId of tokenIds) {
      const cached = this.get(tokenId);
      if (cached) {
        result.set(tokenId, cached);
      } else {
        missingIds.push(tokenId);
      }
    }

    // 2. 批量从 Redis 获取缺失的
    if (missingIds.length > 0) {
      const redisResults = await this.readRedisCacheBatch(missingIds);
      for (const [tokenId, summary] of redisResults) {
        result.set(tokenId, summary);
      }
    }

    return result;
  }

  private async writeRedisCache(summary: TokenQuotaSummary): Promise<void> {
    try {
      await redis.set(this.cacheKeyPrefix + String(summary.token_id), JSON.stringify(summary), 'PX', this.ttlMs);
    } catch { }
  }

  /**
   * 触发预刷新 (当配额低于 10% 时后台刷新)
   * @param token Token 数据
   * @param currentRemaining 当前剩余配额 (0-1)
   */
  triggerPrefetch(token: AntigravityTokenData, currentRemaining: number | null): void {
    // 如果剩余配额低于 10%，触发后台预刷新
    if (currentRemaining !== null && currentRemaining <= 0.10 && !this.prefetchQueue.has(token.id)) {
      this.prefetchQueue.add(token.id);
      console.log(`[QuotaCache] Token #${token.id} quota low (${(currentRemaining * 100).toFixed(1)}%), triggering background prefetch`);
      
      // 异步刷新，不阻塞主流程
      setImmediate(async () => {
        try {
          await this.refreshToken(token);
        } catch (e) {
          console.error(`[QuotaCache] Prefetch failed for token #${token.id}:`, e);
        } finally {
          this.prefetchQueue.delete(token.id);
        }
      });
    }
  }

  async refreshToken(token: AntigravityTokenData, opts: RefreshOptions = {}): Promise<TokenQuotaSummary | null> {
    const locked = await this.acquireFetchLock(token.id, 15000); // Reduced lock time for faster concurrent refresh
    if (!locked) {
      const existing = await this.readRedisCache(token.id);
      if (existing) {
        this.cache.set(token.id, existing);
        return existing;
      }
      return null;
    }

    try {
      const ok = opts.waitForRateLimit ? await this.waitForRateSlot() : await this.withinRate();
      if (!ok) {
        const existing = await this.readRedisCache(token.id);
        if (existing) {
          this.cache.set(token.id, existing);
          return existing;
        }
        return null;
      }

      const data = await AntigravityService.getModelsWithQuotas(token);
      const now = Date.now();
      const per: PerModelQuota[] = Object.entries(data || {}).map(([model_id, q]: [string, any]) => ({
        model_id,
        remaining: typeof q?.remaining === 'number' ? q.remaining : (typeof q?.remainingFraction === 'number' ? q.remainingFraction : null),
        reset_time: q?.resetTime || null,
        window_seconds: typeof q?.windowSeconds === 'number' ? q.windowSeconds : null
      }));
      
      // Only count shared quota models once (Gemini 3 Pro low/high, Claude shared models).
      const isGeminiQuotaModel = (id: string) => id === 'gemini-3-pro-low' || id === 'gemini-3-pro-high';
      const isClaudeQuotaModel = (id: string) =>
        id === 'claude-opus-4-5-thinking' ||
        id.startsWith('claude-opus-4-5-thinking-') ||
        id === 'claude-sonnet-4-5' ||
        id === 'claude-sonnet-4-5-thinking' ||
        id.startsWith('claude-sonnet-4-5-thinking-');
      const pickGroupRemaining = (items: PerModelQuota[]) => {
        const vals = items.map(p => p.remaining).filter((v): v is number => typeof v === 'number');
        return vals.length ? Math.min(1, Math.max(...vals)) : null;
      };
      const geminiRemaining = pickGroupRemaining(per.filter(p => isGeminiQuotaModel(p.model_id)));
      const claudeRemaining = pickGroupRemaining(per.filter(p => isClaudeQuotaModel(p.model_id)));
      const groupVals = [geminiRemaining, claudeRemaining].filter((v): v is number => typeof v === 'number');
      let remaining = groupVals.length ? Math.min(1, groupVals.reduce((a, b) => a + b, 0) / groupVals.length) : null;
      
      // 从 reset_time 提取小时数
      const hoursFromReset = extractNumbersFromObjects(per, p => 
        p.reset_time ? Math.max(0, (new Date(p.reset_time).getTime() - now) / 3600000) : null
      );
      
      // 如果没有 reset_time，则尝试读取窗口秒数（从原始数据）
      let hoursList = hoursFromReset;
      if (hoursList.length === 0) {
        const secondsList = extractNumbersFromNestedData(data || {}, 'windowSeconds');
        hoursList = secondsList.map(s => s / 3600);
      }
      
      // 使用工具函数计算中位数
      const medianHours = calculateMedian(hoursList);

      // Classification Logic with Persistence to prevent drift
      let classification: 'Normal' | 'Pro' | null = null;

      // 1. Get persistent classification from Redis FIRST
      const classKey = `AG_CLASS:${token.id}`;
      const persistentClass = await redis.get(classKey) as 'Normal' | 'Pro' | null;

      // 2. Try to use explicit windowSeconds (Cycle Duration) - most reliable source
      let cycleHours: number | null = null;
      const windowSecondsList = extractNumbersFromNestedData(data || {}, 'windowSeconds');

      if (windowSecondsList.length > 0) {
        const medianSeconds = calculateMedian(windowSecondsList);
        cycleHours = medianSeconds ? medianSeconds / 3600 : null;
      }

      // 3. Determine classification based on available data
      if (cycleHours !== null) {
          // Strategy A: Use explicit window duration (most reliable)
          //   - cycleHours <= 6h => Pro (short window)
          //   - 6h < cycleHours <= 168h (1 week) => Normal
          //   - cycleHours > 168h => treat as Pro (abnormal/likely Pro window)
          let newClass: 'Normal' | 'Pro';
          if (cycleHours <= 6) {
              newClass = 'Pro';
          } else if (cycleHours <= 168) {
              newClass = 'Normal';
          } else {
              newClass = 'Pro';
          }

          // Only update when confident or when no prior class
          const clearlyPro = cycleHours <= 5;
          const clearlyNormal = cycleHours >= 30; // at least >1 day window looks like weekly/long window

          if (!persistentClass) {
              classification = newClass;
          } else if (clearlyPro || clearlyNormal) {
              if (newClass !== persistentClass) {
                  console.log(`[QuotaCache] Token ${token.id} classification changing from ${persistentClass} to ${newClass} (cycleHours=${cycleHours.toFixed(1)})`);
              }
              classification = newClass;
          } else {
              classification = persistentClass;
          }
      } else {
          // Strategy B: No explicit window data - use persistence or heuristic
          if (persistentClass) {
              classification = persistentClass;
          } else if (medianHours !== null) {
              // Heuristic: long reset time => Normal, otherwise Pro
              if (medianHours >= 30) {
                  classification = 'Normal';
              } else if (medianHours <= 12) {
                  classification = 'Pro';
              } else {
                  classification = 'Pro';
              }
          } else {
              const previousLocal = this.cache.get(token.id);
              classification = previousLocal?.classification || null;
          }
      }
      
      // 对 Pro 票据，如果额度缺失或异常偏低（<5%），乐观视为 100% 避免误判
      if (classification === 'Pro' && (remaining === null || remaining < 0.05)) {
          remaining = 1;
      }

      // 如果需要保存分类，使用流水线操作
      if (classification && (!persistentClass || classification !== persistentClass)) {
          await redis.set(classKey, classification, 'EX', 7 * 86400);
      }
      const summary: TokenQuotaSummary = {
        token_id: token.id,
        remaining,
        window_hours: medianHours,
        classification,
        per_model: per,
        fetched_at: now
      };
      this.cache.set(token.id, summary);
      await this.writeRedisCache(summary);
      return summary;
    } finally {
      await this.releaseFetchLock(token.id);
    }
  }
  get(tokenId: number): TokenQuotaSummary | null {
    const s = this.cache.get(tokenId) || null;
    if (s) {
      if (Date.now() - s.fetched_at > this.ttlMs) {
        this.cache.delete(tokenId);
      } else {
        return s;
      }
    }
    return null;
  }
  setTTL(minutes: number) {
    this.ttlMs = Math.max(1, minutes) * 60 * 1000;
  }
  clear() {
    this.cache.clear();
  }
  async getFromRedis(tokenId: number): Promise<TokenQuotaSummary | null> {
    const obj = await this.readRedisCache(tokenId);
    if (obj) {
      this.cache.set(tokenId, obj);
      return obj;
    }
    return null;
  }

  async getPersistentClassification(tokenId: number): Promise<'Normal' | 'Pro' | null> {
    try {
      const cls = await redis.get(`AG_CLASS:${tokenId}`);
      if (cls === 'Normal' || cls === 'Pro') return cls;
    } catch { }
    return null;
  }
}

export const antigravityQuotaCache = new AntigravityQuotaCache();
