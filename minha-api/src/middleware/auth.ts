/**
 * Middleware de Autenticação JWT
 * Protege endpoints da API
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../config/logger';

export interface AuthPayload {
  userId: string;
  advogadoId?: string;
  role: 'ADMIN' | 'USER' | 'SYSTEM';
  type?: 'access' | 'refresh';
  jti?: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required but not set. Set it in production!');
}

const ACCESS_EXPIRES_IN_SECONDS = 3600;   // 1 hour
const REFRESH_EXPIRES_IN_SECONDS = 604800; // 7 days

// In-memory token blacklist (use Redis in production for multi-instance)
const tokenBlacklist = new Set<string>();
const REFRESH_TOKEN_BLACKLIST_PREFIX = 'blacklist:refresh:';

/**
 * Adiciona um token à blacklist
 */
export function blacklistToken(jti: string, isRefresh = false): void {
  if (isRefresh) {
    tokenBlacklist.add(REFRESH_TOKEN_BLACKLIST_PREFIX + jti);
  } else {
    tokenBlacklist.add(jti);
  }
}

/**
 * Verifica se um token está na blacklist
 */
export function isTokenBlacklisted(jti: string, isRefresh = false): boolean {
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
export function verifyToken(token: string, isRefresh = false): AuthPayload {
  const secret = isRefresh ? (JWT_REFRESH_SECRET || JWT_SECRET!) : JWT_SECRET!;
  const decoded = jwt.verify(token, secret) as AuthPayload;

  if (isRefresh && decoded.type !== 'refresh') {
    throw new Error('INVALID_REFRESH_TOKEN_TYPE');
  }
  if (!isRefresh && decoded.type === 'refresh') {
    throw new Error('REFRESH_TOKEN_NOT_ALLOWED_HERE');
  }

  // Verifica blacklist
  if (decoded.jti && isTokenBlacklisted(decoded.jti, isRefresh)) {
    throw new Error('TOKEN_REVOKED');
  }

  return decoded;
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

  try {
    const decoded = verifyToken(token, false);
    req.user = decoded;
    next();
  } catch (error: any) {
    logger.warn('Tentativa de acesso com token inválido:', { error: error.message });

    if (error.name === 'TokenExpiredError') {
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
    try {
      const decoded = verifyToken(parts[1], false);
      req.user = decoded;
    } catch {
      // Token inválido, mas continuamos sem usuário
    }
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
