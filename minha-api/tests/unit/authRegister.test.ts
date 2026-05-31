import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { Request, Response } from 'express';
import { authRouter } from '../../src/routes/auth';
import Advogado from '../../src/models/Advogado';

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('../../src/middleware/auth', () => ({
  generateToken: jest.fn(() => 'access-token'),
  generateRefreshToken: jest.fn(() => 'refresh-token'),
  verifyToken: jest.fn(),
  blacklistToken: jest.fn(),
}));

describe('auth register bridge recovery', () => {
  const mockedFindOne = Advogado.findOne as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JURIDICO_BRIDGE_SECRET = 'bridge-secret';
  });

  afterEach(() => {
    delete process.env.JURIDICO_BRIDGE_SECRET;
  });

  function getRegisterHandler() {
    const layer = (authRouter as any).stack.find((entry: any) => entry.route?.path === '/register');
    return layer.route.stack[0].handle;
  }

  function mockResponse() {
    const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
    res.status = jest.fn((statusCode: number) => {
      res.statusCode = statusCode;
      return res as Response;
    }) as any;
    res.json = jest.fn((body: unknown) => {
      res.body = body;
      return res as Response;
    }) as any;
    return res as Response & { statusCode?: number; body?: any };
  }

  it('bloqueia recuperação de conta bridge sem secret compartilhado', async () => {
    const update = jest.fn(async () => undefined);
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-bridge',
      oab: 'JX123',
      nome: 'Bridge User',
      email: 'bridge@example.com',
      passwordHash: undefined,
      update,
    });

    const req = {
      body: {
        oab: 'jx123',
        nome: 'Atacante',
        senha: 'senha-forte',
      },
      get: jest.fn(() => undefined),
    } as unknown as Request;
    const res = mockResponse();

    await getRegisterHandler()(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.erro.codigo).toBe('FORBIDDEN');
    expect(update).not.toHaveBeenCalled();
  });

  it('permite recuperação de conta bridge passwordless com secret válido', async () => {
    const update = jest.fn(async () => undefined);
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-bridge',
      oab: 'JX123',
      nome: 'Bridge User',
      email: 'bridge@example.com',
      passwordHash: undefined,
      update,
    });

    const req = {
      body: {
        oab: 'jx123',
        nome: 'Bridge User',
        senha: 'senha-forte',
      },
      get: jest.fn((header: string) => (header === 'x-bridge-secret' ? 'bridge-secret' : undefined)),
    } as unknown as Request;
    const res = mockResponse();

    await getRegisterHandler()(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      passwordHash: expect.any(String),
      ativo: true,
    }));
    expect(res.body.accessToken).toBe('access-token');
  });
});
