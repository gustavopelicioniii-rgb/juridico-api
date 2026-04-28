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

const JWT_SECRET = process.env.JWT_SECRET || 'sua-chave-secreta-muito-segura';
const JWT_EXPIRES_IN_SECONDS = 86400; // 24 hours

/**
 * Gera token JWT
 */
export function generateToken(payload: Omit<AuthPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN_SECONDS });
}

/**
 * Verifica token JWT
 */
export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
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
    const decoded = verifyToken(token);
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
      const decoded = verifyToken(parts[1]);
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

/**
 * Gera token de refresh (longa duração)
 */
export function generateRefreshToken(payload: Omit<AuthPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: 604800 }); // 7 days in seconds
}
