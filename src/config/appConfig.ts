import { z } from 'zod';

export type AppConfig = {
  jwtSecret: string;
  port: number;
  redisUrl: string;
  discord: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  admin: {
    username?: string;
    password?: string;
  };
};

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;

  const Env = z.object({
    JWT_SECRET: z.string().optional(),
    PORT: z.string().optional(),
    REDIS_URL: z.string().optional(),
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_CLIENT_SECRET: z.string().optional(),
    DISCORD_REDIRECT_URI: z.string().optional(),
    ADMIN_USERNAME: z.string().optional(),
    ADMIN_PASSWORD: z.string().optional(),
  }).parse(process.env as any);

  const discord = {
    clientId: Env.DISCORD_CLIENT_ID ?? '',
    clientSecret: Env.DISCORD_CLIENT_SECRET ?? '',
    redirectUri: Env.DISCORD_REDIRECT_URI ?? '',
  };

  const admin = {
    username: Env.ADMIN_USERNAME,
    password: Env.ADMIN_PASSWORD,
  };

  const jwtSecret = Env.JWT_SECRET ?? 'dev-secret';
  const port = Env.PORT ? parseInt(String(Env.PORT), 10) : 3000;
  const redisUrl = Env.REDIS_URL ?? 'redis://localhost:6379';

  cached = { jwtSecret, port, redisUrl, discord, admin };
  return cached;
}
