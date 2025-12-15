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
   * If we cannot refresh and fetch userinfo.email, mark credential as DEAD.
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
                          continue;
                      }

                      if (!cred.google_email || cred.google_email !== email) {
                          await prisma.googleCredential.update({
                              where: { id: cred.id },
                              data: { google_email: email }
                          });
                      }
                  } catch (e: any) {
                      console.error(`[CronService] Credential ${cred.id} userinfo fetch failed:`, e.response?.data || e.message);
                      await this.markCredentialDead(cred.id, 'Failed to fetch userinfo');
                      continue;
                  }
              } catch (e: any) {
                  console.error(`[CronService] Credential ${cred.id} token refresh failed:`, e.response?.data || e.message);
                  await this.markCredentialDead(cred.id, 'Token refresh failed');
                  continue;
              }
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
   * Health check for Antigravity tokens by sending a simple "Hi" to a base model.
   * Ignore 429 (rate limit) errors; delete tokens that fail with other errors and record usage log.
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
                  await AntigravityService.generateResponse(
                      [{ role: 'user', content: 'Hi' }],
                      'gemini-2.5-flash',
                      { max_tokens: 16, temperature: 0.1 },
                      undefined,
                      tokenData
                  );
              } catch (e: any) {
                  const msg = e?.message || '';
                  const is429 = msg.includes('429');
                  if (is429) {
                      continue;
                  }
                  
                  // Delete invalid token and record a usage log for user visibility
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
                  } catch {}
                  
                  console.warn(`[CronService] Antigravity token ${t.id} (${t.email || 'unknown'}) removed due to failed health check.`);
              }
          }
          
          if (removed > 0) {
              console.log(`[CronService] Antigravity health check removed ${removed} invalid tokens.`);
          }
      } catch (error) {
          console.error('[CronService] Failed to run Antigravity token health check:', error);
      }
  }
}
