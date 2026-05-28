import { NextFunction, Request, Response } from 'express';
import { cache } from '../config/redis';

const WINDOW_SECONDS = Number(process.env.ACCOUNT_RATE_LIMIT_WINDOW_SECONDS || 60);
const LIMIT_FREE = Number(process.env.ACCOUNT_RATE_LIMIT_FREE || 120);
const LIMIT_PRO = Number(process.env.ACCOUNT_RATE_LIMIT_PRO || 600);
const LIMIT_ADMIN = Number(process.env.ACCOUNT_RATE_LIMIT_ADMIN || 2000);

const resolveLimit = (req: Request): number => {
  if (req.user?.role === 'ADMIN' || req.user?.role === 'SYSTEM') return LIMIT_ADMIN;
  const plan = String((req.headers['x-account-plan'] || req.headers['x-plan'] || 'free')).toLowerCase();
  if (plan === 'pro' || plan === 'business') return LIMIT_PRO;
  return LIMIT_FREE;
};

const resolveActorKey = (req: Request): string => {
  return req.user?.advogadoId || req.user?.userId || req.ip || 'anonymous';
};

export async function accountRateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.path.startsWith('/')) {
    next();
    return;
  }

  const limit = resolveLimit(req);
  const actorKey = resolveActorKey(req);
  const bucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `ratelimit:account:${actorKey}:${bucket}`;

  const usage = await cache.incr(key, WINDOW_SECONDS);
  if (usage > limit) {
    res.status(429).json({
      erro: {
        codigo: 'ACCOUNT_RATE_LIMIT_EXCEEDED',
        mensagem: `Limite por conta excedido para janela de ${WINDOW_SECONDS}s.`,
      },
    });
    return;
  }

  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - usage)));
  next();
}

