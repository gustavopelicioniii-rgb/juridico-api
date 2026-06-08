import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { authRouter } from '../../src/routes/auth';
import { generateRefreshToken } from '../../src/middleware/auth';
import Advogado from '../../src/models/Advogado';

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    create: jest.fn(),
    findByPk: jest.fn(),
  },
}));

type RouterResult = {
  statusCode: number;
  body: any;
};

function invokeAuthRoute(method: string, url: string, body: Record<string, unknown>): Promise<RouterResult> {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      originalUrl: url,
      baseUrl: '',
      path: url,
      headers: {},
      body,
    } as unknown as Request;

    let statusCode = 200;
    const res = {
      status: jest.fn((code: number) => {
        statusCode = code;
        return res;
      }),
      json: jest.fn((payload: unknown) => {
        resolve({ statusCode, body: payload });
        return res;
      }),
    } as unknown as Response;

    authRouter.handle(req, res, (error: unknown) => {
      if (error) {
        reject(error);
      } else {
        reject(new Error(`Route ${method} ${url} did not send a response`));
      }
    });
  });
}

describe('auth routes', () => {
  const mockedFindOne = Advogado.findOne as unknown as jest.Mock;
  const mockedFindByPk = Advogado.findByPk as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_OAB;
    delete process.env.ADMIN_EMAIL;
  });

  it('rejects public claims of existing passwordless bridge accounts', async () => {
    const update = jest.fn();
    (mockedFindOne as any).mockResolvedValue({
      id: 'bridge-1',
      oab: 'JX123',
      nome: 'Bridge Account',
      email: 'owner@example.com',
      passwordHash: null,
      ativo: true,
      update,
    });

    const result = await invokeAuthRoute('POST', '/register', {
      oab: 'JX123',
      nome: 'Attacker',
      email: 'attacker@example.com',
      senha: 'password123',
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.erro.codigo).toBe('DUPLICATE_OAB');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects public registration with reserved admin credentials', async () => {
    process.env.ADMIN_OAB = 'ADMIN123';

    const result = await invokeAuthRoute('POST', '/register', {
      oab: 'ADMIN123',
      nome: 'Attacker',
      email: 'attacker@example.com',
      senha: 'password123',
    });

    expect(result.statusCode).toBe(403);
    expect(result.body.erro.codigo).toBe('RESERVED_ADMIN_ACCOUNT');
    expect(mockedFindOne).not.toHaveBeenCalled();
  });

  it('does not grant ADMIN role from ADMIN_EMAIL alone', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    const passwordHash = await bcrypt.hash('password123', 4);
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-1',
      oab: '123456',
      nome: 'Regular User',
      email: 'admin@example.com',
      passwordHash,
      ativo: true,
    });

    const result = await invokeAuthRoute('POST', '/login', {
      email: 'admin@example.com',
      senha: 'password123',
    });

    expect(result.statusCode).toBe(200);
    const decoded = jwt.verify(result.body.accessToken, process.env.JWT_SECRET!) as jwt.JwtPayload;
    expect(decoded.role).toBe('USER');
  });

  it('grants ADMIN role only for the configured admin OAB', async () => {
    process.env.ADMIN_OAB = 'ADMIN123';
    const passwordHash = await bcrypt.hash('password123', 4);
    (mockedFindOne as any).mockResolvedValue({
      id: 'admin-1',
      oab: 'ADMIN123',
      nome: 'Admin User',
      email: 'admin@example.com',
      passwordHash,
      ativo: true,
    });

    const result = await invokeAuthRoute('POST', '/login', {
      oab: 'ADMIN123',
      senha: 'password123',
    });

    expect(result.statusCode).toBe(200);
    const decoded = jwt.verify(result.body.accessToken, process.env.JWT_SECRET!) as jwt.JwtPayload;
    expect(decoded.role).toBe('ADMIN');
  });

  it('rejects refresh tokens for inactive backing accounts', async () => {
    (mockedFindByPk as any).mockResolvedValue({
      id: 'adv-1',
      ativo: false,
    });
    const refreshToken = generateRefreshToken({
      userId: 'adv-1',
      advogadoId: 'adv-1',
      role: 'USER',
    });

    const result = await invokeAuthRoute('POST', '/refresh', { refreshToken });

    expect(result.statusCode).toBe(401);
    expect(result.body.erro.codigo).toBe('INVALID_REFRESH_TOKEN');
  });
});
