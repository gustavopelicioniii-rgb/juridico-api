/**
 * Rotas de Autenticação
 */

import { Router, Request, Response } from 'express';
import { generateToken, generateRefreshToken, verifyToken, AuthPayload } from '../middleware/auth';
import Advogado from '../models/Advogado';

const router = Router();

/**
 * POST /api/v1/auth/login
 * Autentica advogado e retorna token JWT
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { oab, email } = req.body;
    
    if (!oab && !email) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'OAB ou email são obrigatórios.' }
      });
    }
    
    // Busca advogado
    const advogado = await Advogado.findOne({
      where: {
        ...(oab && { oab }),
        ...(email && { email }),
        ativo: true,
      },
    });
    
    if (!advogado) {
      return res.status(401).json({
        erro: { codigo: 'UNAUTHORIZED', mensagem: 'Credenciais inválidas.' }
      });
    }
    
    // Gera tokens
    const payload: Omit<AuthPayload, 'iat' | 'exp'> = {
      userId: advogado.id,
      advogadoId: advogado.id,
      role: 'USER',
    };
    
    const accessToken = generateToken(payload);
    const refreshToken = generateRefreshToken(payload);
    
    res.json({
      accessToken,
      refreshToken,
      expiresIn: '24h',
      advogado: {
        id: advogado.id,
        oab: advogado.oab,
        nome: advogado.nome,
        email: advogado.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      erro: { codigo: 'LOGIN_ERROR', mensagem: 'Erro ao realizar login.' }
    });
  }
});

/**
 * POST /api/v1/auth/refresh
 * Renova token de acesso
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'Refresh token é obrigatório.' }
      });
    }
    
    try {
      const decoded = verifyToken(refreshToken);
      
      const payload: Omit<AuthPayload, 'iat' | 'exp'> = {
        userId: decoded.userId,
        advogadoId: decoded.advogadoId,
        role: decoded.role,
      };
      
      const accessToken = generateToken(payload);
      const newRefreshToken = generateRefreshToken(payload);
      
      res.json({
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: '24h',
      });
    } catch {
      return res.status(401).json({
        erro: { codigo: 'INVALID_REFRESH_TOKEN', mensagem: 'Refresh token inválido ou expirado.' }
      });
    }
  } catch (error) {
    res.status(500).json({
      erro: { codigo: 'REFRESH_ERROR', mensagem: 'Erro ao renovar token.' }
    });
  }
});

/**
 * GET /api/v1/auth/me
 * Retorna dados do usuário autenticado
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        erro: { codigo: 'UNAUTHORIZED', mensagem: 'Token não fornecido.' }
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    
    const advogado = await Advogado.findByPk(decoded.advogadoId);
    
    if (!advogado || !advogado.ativo) {
      return res.status(404).json({
        erro: { codigo: 'USER_NOT_FOUND', mensagem: 'Usuário não encontrado.' }
      });
    }
    
    res.json({
      id: advogado.id,
      oab: advogado.oab,
      nome: advogado.nome,
      email: advogado.email,
      role: decoded.role,
    });
  } catch (error) {
    res.status(500).json({
      erro: { codigo: 'ME_ERROR', mensagem: 'Erro ao buscar dados do usuário.' }
    });
  }
});

export { router as authRouter };
