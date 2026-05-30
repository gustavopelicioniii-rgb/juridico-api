/**
 * Middleware de Autenticação JWT
 * Protege endpoints da API
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../config/logger';
import { cache } from '../config/redis';

export interface AuthPayload {
  userId: string;
  advogadoId?: string;
  role: 'ADMIN' | 'USER' | 'SYSTEM';
  type?: 'access' | 'refresh';
  jti?: string;
  iat?: number;
  exp?: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthPayload;
  }
}

const UNSAFE_JWT_SECRETS = new Set(['dev-secret-unsafe', 'dev-refresh-secret-unsafe']);

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-unsafe';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-unsafe';

/**
 * Falha o startup em produção se secrets JWT não estiverem configurados.
 */
export function validateAuthConfig(): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  if (!process.env.JWT_SECRET || UNSAFE_JWT_SECRETS.has(process.env.JWT_SECRET)) {
    throw new Error('FATAL: JWT_SECRET must be set to a strong value in production.');
  }

  if (!process.env.JWT_REFRESH_SECRET || UNSAFE_JWT_SECRETS.has(process.env.JWT_REFRESH_SECRET)) {
    throw new Error('FATAL: JWT_REFRESH_SECRET must be set to a strong value in production.');
  }
}

const ACCESS_EXPIRES_IN_SECONDS = 3600;   // 1 hour
const REFRESH_EXPIRES_IN_SECONDS = 604800; // 7 days

// In-memory fallback for revogados quando Redis estiver indisponível
const tokenBlacklist = new Set<string>();
const REFRESH_TOKEN_BLACKLIST_PREFIX = 'blacklist:refresh:';
const ACCESS_TOKEN_BLACKLIST_PREFIX = 'blacklist:access:';

/**
 * Adiciona um token à blacklist
 */
export async function blacklistToken(jti: string, expiresAt?: number, isRefresh = false): Promise<void> {
  const ttlSeconds = expiresAt ? Math.max(1, expiresAt - Math.floor(Date.now() / 1000)) : 3600;
  const prefix = isRefresh ? REFRESH_TOKEN_BLACKLIST_PREFIX : ACCESS_TOKEN_BLACKLIST_PREFIX;
  await cache.set(`${prefix}${jti}`, '1', ttlSeconds);
  if (isRefresh) {
    tokenBlacklist.add(REFRESH_TOKEN_BLACKLIST_PREFIX + jti);
  } else {
    tokenBlacklist.add(jti);
  }
}

/**
 * Verifica se um token está na blacklist
 */
export async function isTokenBlacklisted(jti: string, isRefresh = false): Promise<boolean> {
  const prefix = isRefresh ? REFRESH_TOKEN_BLACKLIST_PREFIX : ACCESS_TOKEN_BLACKLIST_PREFIX;
  const fromCache = await cache.get(`${prefix}${jti}`);
  if (fromCache) return true;
  if (isRefresh) {
    return tokenBlacklist.has(REFRESH_TOKEN_BLACKLIST_PREFIX + jti);
  }
  return tokenBlacklist.has(jti);
}

/**
 * Gera token de acesso JWT
 */
export function generateToken(payload: Omit<AuthPayload, 'iat' | 'exp' | 'type'>): string {
  const jti = crypto.randomUUID();
  return jwt.sign(
    { ...payload, type: 'access', jti },
    JWT_SECRET!,
    { expiresIn: ACCESS_EXPIRES_IN_SECONDS }
  );
}

/**
 * Gera refresh token JWT (longa duração)
 */
export function generateRefreshToken(payload: Omit<AuthPayload, 'iat' | 'exp' | 'type'>): string {
  if (!JWT_REFRESH_SECRET) {
    throw new Error('FATAL: JWT_REFRESH_SECRET environment variable is required. Set it in production!');
  }
  const jti = crypto.randomUUID();
  return jwt.sign(
    { ...payload, type: 'refresh', jti },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN_SECONDS }
  );
}

/**
 * Verifica token JWT
 */
export async function verifyToken(token: string, isRefresh = false): Promise<AuthPayload> {
  const secret = isRefresh ? (JWT_REFRESH_SECRET || JWT_SECRET!) : JWT_SECRET!;
  const decoded = jwt.verify(token, secret) as AuthPayload;

  if (isRefresh && decoded.type !== 'refresh') {
    throw new Error('INVALID_REFRESH_TOKEN_TYPE');
  }
  if (!isRefresh && decoded.type === 'refresh') {
    throw new Error('REFRESH_TOKEN_NOT_ALLOWED_HERE');
  }

  // Verifica blacklist
  if (decoded.jti && await isTokenBlacklisted(decoded.jti, isRefresh)) {
    throw new Error('TOKEN_REVOKED');
  }

  return decoded;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

/**
 * Middleware de autenticação obrigatório
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      erro: {
        codigo: 'UNAUTHORIZED',
        mensagem: 'Token de autenticação não fornecido.',
      },
    });
    return;
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({
      erro: {
        codigo: 'INVALID_TOKEN_FORMAT',
        mensagem: 'Formato de token inválido. Use: Bearer <token>',
      },
    });
    return;
  }

  const token = parts[1];

  void (async () => {
    try {
      const decoded = await verifyToken(token, false);
      req.user = decoded;
      next();
    } catch (error) {
      logger.warn('Tentativa de acesso com token inválido:', { error: getErrorMessage(error) });

      if (getErrorName(error) === 'TokenExpiredError') {
        res.status(401).json({
          erro: {
            codigo: 'TOKEN_EXPIRED',
            mensagem: 'Token de autenticação expirado.',
          },
        });
        return;
      }

      res.status(401).json({
        erro: {
          codigo: 'INVALID_TOKEN',
          mensagem: 'Token de autenticação inválido.',
        },
      });
    }
  })();
}

/**
 * Middleware opcional - não bloqueia se não tiver token
 */
export function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next();
    return;
  }

  const parts = authHeader.split(' ');

  if (parts.length === 2 && parts[0] === 'Bearer') {
    void (async () => {
      try {
        const decoded = await verifyToken(parts[1], false);
        req.user = decoded;
      } catch {
        // Token inválido, mas continuamos sem usuário
      } finally {
        next();
      }
    })();
    return;
  }

  next();
}

/**
 * Middleware para verificar papel do usuário
 */
export function requireRole(...roles: AuthPayload['role'][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        erro: {
          codigo: 'UNAUTHORIZED',
          mensagem: 'Autenticação requerida.',
        },
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        erro: {
          codigo: 'FORBIDDEN',
          mensagem: 'Você não tem permissão para acessar este recurso.',
        },
      });
      return;
    }

    next();
  };
}
