import { AddressInfo } from 'net';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { authRouter } from '../../src/routes/auth';
import {
  authMiddleware,
  generateRefreshToken,
  generateToken,
  AuthPayload,
} from '../../src/middleware/auth';
import Advogado from '../../src/models/Advogado';

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  },
}));

const mockedFindOne = Advogado.findOne as unknown as jest.Mock;
const mockedFindByPk = Advogado.findByPk as unknown as jest.Mock;

async function postAuth(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

describe('auth security invariants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_OAB = 'ADMIN123';
    process.env.ADMIN_EMAIL = 'admin@example.com';
  });

  it('rejeita claim público de conta bridge sem senha', async () => {
    const update = jest.fn(async () => undefined);
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-bridge',
      oab: 'JX123',
      nome: 'Conta bridge',
      email: 'bridge@example.com',
      passwordHash: null,
      ativo: true,
      update,
    });

    const response = await postAuth('/register', {
      oab: 'JX123',
      nome: 'Atacante',
      email: 'attacker@example.com',
      senha: 'senha-segura',
    });

    expect(response.status).toBe(409);
    expect(response.body.erro.codigo).toBe('DUPLICATE_OAB');
    expect(update).not.toHaveBeenCalled();
  });

  it('bloqueia cadastro público com credenciais reservadas de admin', async () => {
    const response = await postAuth('/register', {
      oab: 'admin123',
      nome: 'Atacante',
      email: 'attacker@example.com',
      senha: 'senha-segura',
    });

    expect(response.status).toBe(403);
    expect(response.body.erro.codigo).toBe('RESERVED_ADMIN_CREDENTIAL');
    expect(mockedFindOne).not.toHaveBeenCalled();
  });

  it('não concede ADMIN apenas por email igual a ADMIN_EMAIL', async () => {
    const passwordHash = await bcrypt.hash('senha-segura', 12);
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-user',
      oab: 'USER123',
      nome: 'Usuário comum',
      email: 'admin@example.com',
      passwordHash,
      ativo: true,
    });

    const response = await postAuth('/login', {
      oab: 'USER123',
      senha: 'senha-segura',
    });

    expect(response.status).toBe(200);
    const decoded = jwt.decode(response.body.accessToken) as AuthPayload;
    expect(decoded.role).toBe('USER');
  });

  it('rejeita refresh token de advogado inativo', async () => {
    const refreshToken = generateRefreshToken({
      userId: 'adv-inactive',
      advogadoId: 'adv-inactive',
      role: 'USER',
    });
    (mockedFindByPk as any).mockResolvedValue({
      id: 'adv-inactive',
      ativo: false,
    });

    const response = await postAuth('/refresh', { refreshToken });

    expect(response.status).toBe(401);
    expect(response.body.erro.codigo).toBe('INVALID_REFRESH_TOKEN');
  });

  it('middleware rejeita access token de advogado inativo', async () => {
    const token = generateToken({
      userId: 'adv-inactive',
      advogadoId: 'adv-inactive',
      role: 'USER',
    });
    const next = jest.fn();
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const req = {
      headers: { authorization: `Bearer ${token}` },
    };
    const res = { status, json };
    (mockedFindByPk as any).mockResolvedValue({
      id: 'adv-inactive',
      ativo: false,
    });

    authMiddleware(req as any, res as any, next);
    await new Promise(resolve => setImmediate(resolve));

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      erro: expect.objectContaining({ codigo: 'INVALID_TOKEN' }),
    }));
  });
});
