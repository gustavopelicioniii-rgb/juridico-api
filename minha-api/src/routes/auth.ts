/**
 * Rotas de Autenticação
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { generateToken, generateRefreshToken, verifyToken, blacklistToken, AuthPayload } from '../middleware/auth';
import Advogado from '../models/Advogado';

const router = Router();
const normalize = (value?: string | null): string | undefined => value?.trim().toUpperCase();
const isAdminAccount = (oab?: string, email?: string): boolean => {
  const adminOab = normalize(process.env.ADMIN_OAB);
  const currentOab = normalize(oab);
  if (adminOab && currentOab && adminOab === currentOab) {
    return true;
  }

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const currentEmail = email?.trim().toLowerCase();
  return !!adminEmail && !!currentEmail && adminEmail === currentEmail;
};

/**
 * POST /api/v1/auth/login
 * Autentica advogado com OAB + senha
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { oab, email, senha } = req.body;

    if (!oab && !email) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'OAB ou email são obrigatórios.' }
      });
    }

    if (!senha) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'Senha é obrigatória.' }
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

    // Verifica senha
    if (!advogado.passwordHash) {
      return res.status(401).json({
        erro: { codigo: 'NO_PASSWORD_SET', mensagem: 'Conta não configurada. Solicite reset de senha.' }
      });
    }

    const senhaValida = await bcrypt.compare(senha, advogado.passwordHash);
    if (!senhaValida) {
      return res.status(401).json({
        erro: { codigo: 'UNAUTHORIZED', mensagem: 'Credenciais inválidas.' }
      });
    }

    // Gera tokens
    const payload: Omit<AuthPayload, 'iat' | 'exp'> = {
      userId: advogado.id,
      advogadoId: advogado.id,
      role: isAdminAccount(advogado.oab, advogado.email) ? 'ADMIN' : 'USER',
    };

    const accessToken = generateToken(payload);
    const refreshToken = generateRefreshToken(payload);

    res.json({
      accessToken,
      refreshToken,
      expiresIn: '1h',
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
 * POST /api/v1/auth/register
 * Cadastra novo advogado com senha
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { oab, nome, email, senha } = req.body;

    if (!oab || !nome || !senha) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'OAB, nome e senha são obrigatórios.' }
      });
    }

    if (senha.length < 8) {
      return res.status(400).json({
        erro: { codigo: 'VALIDATION_ERROR', mensagem: 'Senha deve ter pelo menos 8 caracteres.' }
      });
    }

    const existing = await Advogado.findOne({ where: { oab } });
    if (existing) {
      return res.status(409).json({
        erro: { codigo: 'DUPLICATE_OAB', mensagem: 'Já existe advogado com esta OAB.' }
      });
    }

    const passwordHash = await bcrypt.hash(senha, 12);

    const advogado = await Advogado.create({
      oab,
      nome,
      email,
      passwordHash,
      ativo: true,
    });

    const { default: AdvogadoOnboardingService } = await import('../services/AdvogadoOnboardingService');
    void AdvogadoOnboardingService.start({
      advogadoId: advogado.id,
      oab: advogado.oab,
      nome: advogado.nome,
      source: 'self-register',
      requestedBy: 'self-register',
    });

    const payload: Omit<AuthPayload, 'iat' | 'exp'> = {
      userId: advogado.id,
      advogadoId: advogado.id,
      role: 'USER',
    };

    const accessToken = generateToken(payload);
    const refreshToken = generateRefreshToken(payload);

    res.status(201).json({
      accessToken,
      refreshToken,
      expiresIn: '1h',
      advogado: {
        id: advogado.id,
        oab: advogado.oab,
        nome: advogado.nome,
        email: advogado.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      erro: { codigo: 'REGISTER_ERROR', mensagem: 'Erro ao criar conta.' }
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
      const decoded = await verifyToken(refreshToken, true);
      if (decoded.jti) {
        await blacklistToken(decoded.jti, decoded.exp, true);
      }

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
        expiresIn: '1h',
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
 * POST /api/v1/auth/logout
 * Invalida o token (logout client-side + server-side)
 */
router.post('/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const refreshToken = req.body?.refreshToken as string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = await verifyToken(token, false);
      if (decoded.jti) {
        await blacklistToken(decoded.jti, decoded.exp, false);
      }
    } catch {
      // Token inválido já expira ou é inválido
    }
  }

  if (refreshToken) {
    try {
      const decodedRefresh = await verifyToken(refreshToken, true);
      if (decodedRefresh.jti) {
        await blacklistToken(decodedRefresh.jti, decodedRefresh.exp, true);
      }
    } catch {
      // refresh inválido/expirado
    }
  }

  res.json({ mensagem: 'Logout realizado com sucesso.' });
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
    const decoded = await verifyToken(token, false);

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
