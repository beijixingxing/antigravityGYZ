import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import crypto from 'crypto';
import { getConfig } from '../config/appConfig';

const prisma = new PrismaClient();
const JWT_SECRET = getConfig().jwtSecret;

const AuthSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(6),
});

const RegisterSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(6).max(128),
  confirmPassword: z.string().min(6).max(128),
}).refine(data => data.password === data.confirmPassword, {
  message: '两次密码不一致',
  path: ['confirmPassword']
});

const ChangePasswordSchema = z.object({
  oldPassword: z.string(),
  newPassword: z.string().min(6),
});

export default async function authRoutes(fastify: FastifyInstance) {
  
  // POST /api/auth/register
  fastify.post('/register', async (req, reply) => {
    const { username, password } = RegisterSchema.parse(req.body);

    // Fetch System Config
    const configSetting = await prisma.systemSetting.findUnique({ where: { key: 'SYSTEM_CONFIG' } });
    let enableReg = true;
    let defaultQuota = 300;
    if (configSetting) {
        try {
            const conf = JSON.parse(configSetting.value);
            enableReg = conf.enable_registration ?? true;
            defaultQuota = conf.quota?.newbie ?? 300;
        } catch (e) {}
    }

    if (!enableReg) return reply.code(403).send({ error: 'New user registration is currently disabled.' });

    const existing = await prisma.user.findUnique({ where: { email: username } });
    if (existing) return reply.code(409).send({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await prisma.user.create({
      data: {
        email: username,
        username: username,
        password: hashedPassword,
        daily_limit: defaultQuota
      }
    });

    return { id: user.id, email: user.email, message: 'Registered successfully.' };
  });

  fastify.get('/discord/url', async (req) => {
    const { discord } = getConfig();
    const clientId = discord.clientId;
    const redirectUri = discord.redirectUri;
    if (!clientId || !redirectUri) {
      return { error: 'Discord OAuth not configured' };
    }
    const mode = (req.query as any)?.mode === 'bind' ? 'bind' : 'login';
    const scope = encodeURIComponent('identify');
    const url = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&prompt=consent&state=${encodeURIComponent(mode)}`;
    return { url };
  });

  fastify.get('/discord/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    const { discord } = getConfig();
    const clientId = discord.clientId;
    const clientSecret = discord.clientSecret;
    const redirectUri = discord.redirectUri;
    const code = (req.query as any)?.code;
    const state = (req.query as any)?.state || 'login';
    if (!clientId || !clientSecret || !redirectUri) {
      return reply.code(500).send({ error: 'Discord OAuth not configured' });
    }
    if (!code) {
      return reply.code(400).send({ error: 'Missing code' });
    }
    try {
      const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: redirectUri
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      const accessToken = tokenRes.data.access_token;
      if (!accessToken) {
        return reply.code(400).send({ error: 'Failed to exchange token' });
      }
      const userRes = await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const du = userRes.data || {};
      if (state === 'bind') {
        const payload = {
          discordId: String(du.id || ''),
          discordUsername: String(du.global_name || du.username || ''),
          discordAvatar: du.avatar ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png` : ''
        };
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bind Discord</title></head><body><script>
          (async () => {
            const token = sessionStorage.getItem('token') || localStorage.getItem('token');
            if (!token) { alert('未登录，无法绑定'); location.href='/login'; return; }
            try {
              const res = await fetch('/api/auth/discord/bind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: ${JSON.stringify(JSON.stringify(payload))}
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || '绑定失败');
              location.href = '/dashboard';
            } catch (e) {
              alert(e.message || '绑定失败');
              location.href = '/dashboard';
            }
          })();
        </script></body></html>`;
        return reply.type('text/html').send(html);
      } else {
        const discordIdStr = String(du.id || '');
        const display = du.global_name || du.username || `discord:${discordIdStr}`;
        const discordEmail = `discord:${discordIdStr}`;
        let user = await prisma.user.findFirst({ where: ({ discordId: discordIdStr } as any) });
        if (!user) {
          let autoUser = await prisma.user.findUnique({ where: { email: discordEmail } });
          if (!autoUser) {
            const configSetting = await prisma.systemSetting.findUnique({ where: { key: 'SYSTEM_CONFIG' } });
            let defaultQuota = 300;
            if (configSetting) {
              try {
                const conf = JSON.parse(configSetting.value);
                defaultQuota = conf.quota?.newbie ?? 300;
              } catch (e) {}
            }
            const rand = crypto.randomBytes(24).toString('hex');
            const hashed = await bcrypt.hash(rand, 10);
            
            let finalUsername = du.username || `user_${discordIdStr}`;
            // Check for username collision
            const nameExists = await prisma.user.findUnique({ where: { username: finalUsername } });
            if (nameExists) {
                finalUsername = `${finalUsername}_${discordIdStr.slice(-4)}`;
            }

            user = await prisma.user.create({
              data: ({
                email: discordEmail,
                username: finalUsername,
                password: hashed,
                daily_limit: defaultQuota,
                discordId: discordIdStr,
                discordUsername: String(du.global_name || du.username || ''),
                discordAvatar: du.avatar ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png` : null
              } as any)
            });
          } else {
            user = autoUser;
          }
        }
        const autoUser = await prisma.user.findUnique({ where: { email: discordEmail } });
        if (autoUser && autoUser.id !== user.id) {
          await prisma.$transaction(async (tx) => {
            await tx.apiKey.updateMany({ where: { user_id: autoUser.id }, data: { user_id: user.id } });
            await tx.googleCredential.updateMany({ where: { owner_id: autoUser.id }, data: { owner_id: user.id } });
            await tx.antigravityToken.updateMany({ where: { owner_id: autoUser.id }, data: { owner_id: user.id } });
            await tx.usageLog.updateMany({ where: { user_id: autoUser.id }, data: { user_id: user.id } });
            await tx.user.delete({ where: { id: autoUser.id } });
          });
        }
        await prisma.user.update({
          where: { id: user.id },
          data: ({
            discordId: discordIdStr,
            discordUsername: String(du.global_name || du.username || ''),
            discordAvatar: du.avatar ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png` : null
          } as any)
        });
        const token = jwt.sign(
          { id: user.id, email: display, role: user.role },
          JWT_SECRET,
          { expiresIn: '7d' }
        );
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Login</title></head><body><script>
          const token = ${JSON.stringify(token)};
          sessionStorage.setItem('token', token);
          localStorage.setItem('token', token);
          if (window.opener) {
            window.opener.postMessage({ type: 'discord-login-success', token: token }, '*');
            window.close();
          } else {
            location.href = '/dashboard';
          }
        </script></body></html>`;
        return reply.type('text/html').send(html);
      }
    } catch (e: any) {
      return reply.code(500).send({ error: e.response?.data || e.message });
    }
  });

  fastify.post('/discord/bind', async (req: any, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');
    let userId: number | null = null;
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      userId = decoded.id;
    } catch {
      return reply.code(401).send({ error: 'Invalid token' });
    }
    const body = req.body as any;
    const discordId = String(body.discordId || '').trim();
    const discordUsername = String(body.discordUsername || '').trim();
    const discordAvatar = String(body.discordAvatar || '').trim() || null;
    if (!discordId) return reply.code(400).send({ error: 'Missing discordId' });
    let exists = await prisma.user.findFirst({ where: ({ discordId } as any) });
    const autoUser = await prisma.user.findUnique({ where: { email: `discord:${discordId}` } });
    if (exists && exists.id !== userId && (!exists.email.startsWith('discord:'))) {
      return reply.code(409).send({ error: '该 Discord 账户已绑定其他用户' });
    }
    await prisma.$transaction(async (tx) => {
      if (autoUser && autoUser.id !== userId) {
        await tx.apiKey.updateMany({ where: { user_id: autoUser.id }, data: { user_id: userId! } });
        await tx.googleCredential.updateMany({ where: { owner_id: autoUser.id }, data: { owner_id: userId! } });
        await tx.antigravityToken.updateMany({ where: { owner_id: autoUser.id }, data: { owner_id: userId! } });
        await tx.usageLog.updateMany({ where: { user_id: autoUser.id }, data: { user_id: userId! } });
        await tx.user.delete({ where: { id: autoUser.id } });
      }
      await tx.user.update({
        where: { id: userId! },
        data: ({ discordId, discordUsername, discordAvatar } as any)
      });
    });
    return { success: true };
  });

  fastify.post('/discord/unbind', async (req: any, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');
    let userId: number | null = null;
    try { userId = (jwt.verify(token, JWT_SECRET) as any).id; } catch { return reply.code(401).send({ error: 'Invalid token' }); }
    await prisma.user.update({ where: { id: userId! }, data: ({ discordId: null, discordUsername: null, discordAvatar: null } as any) });
    return { success: true };
  });

  // POST /api/auth/login
  fastify.post('/login', async (req, reply) => {
    const { username, password } = AuthSchema.parse(req.body);

    const user = await prisma.user.findFirst({ where: ({ OR: [{ username }, { email: username }] } as any) });
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' });

    if (!user.is_active) return reply.code(403).send({ error: 'Account disabled' });

    // Sign Token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    return { 
        token, 
        user: { 
            id: user.id, 
            email: user.email, 
            role: user.role, 
            level: user.level
        } 
    };
  });

  // POST /api/auth/change-password
  fastify.post('/change-password', async (req: any, reply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Unauthorized' });
    
    const token = authHeader.replace('Bearer ', '');
    let userId;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        userId = decoded.id;
    } catch (e) {
        return reply.code(401).send({ error: 'Invalid token' });
    }

    const { oldPassword, newPassword } = ChangePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) return reply.code(400).send({ error: 'Old password incorrect' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
    });

    return { success: true, message: 'Password updated' };
  });
}
