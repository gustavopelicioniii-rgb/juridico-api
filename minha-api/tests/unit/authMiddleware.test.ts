import { NextFunction, Request, Response } from 'express';
import { jest } from '@jest/globals';
import Advogado from '../../src/models/Advogado';
import { authMiddleware, generateToken } from '../../src/middleware/auth';

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
  },
}));

jest.mock('../../src/config/redis', () => ({
  cache: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
  },
}));

jest.mock('../../src/config/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
  },
}));

type MockResponse = Pick<Response, 'status' | 'json'> & {
  statusCode: number;
  body?: unknown;
};

const makeResponse = (): MockResponse => {
  const res: MockResponse = {
    statusCode: 200,
    status: jest.fn((statusCode: number) => {
      res.statusCode = statusCode;
      return res;
    }) as unknown as Response['status'],
    json: jest.fn((body: unknown) => {
      res.body = body;
      return res;
    }) as unknown as Response['json'],
  };

  return res;
};

const waitForMiddleware = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('auth middleware', () => {
  const mockedFindByPk = Advogado.findByPk as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejeita token de acesso quando o advogado foi desativado', async () => {
    const token = generateToken({ userId: 'adv-1', advogadoId: 'adv-1', role: 'USER' });
    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as Request;
    const res = makeResponse();
    const next = jest.fn() as NextFunction;
    (mockedFindByPk as any).mockResolvedValue({ id: 'adv-1', ativo: false });

    authMiddleware(req, res as unknown as Response, next);
    await waitForMiddleware();

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      erro: {
        codigo: 'INVALID_TOKEN',
        mensagem: 'Token de autenticação inválido.',
      },
    });
  });

  it('aceita token de acesso quando o advogado continua ativo', async () => {
    const token = generateToken({ userId: 'adv-1', advogadoId: 'adv-1', role: 'USER' });
    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as Request;
    const res = makeResponse();
    const next = jest.fn() as NextFunction;
    (mockedFindByPk as any).mockResolvedValue({ id: 'adv-1', ativo: true });

    authMiddleware(req, res as unknown as Response, next);
    await waitForMiddleware();

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({
      userId: 'adv-1',
      advogadoId: 'adv-1',
      role: 'USER',
      type: 'access',
    });
  });
});
