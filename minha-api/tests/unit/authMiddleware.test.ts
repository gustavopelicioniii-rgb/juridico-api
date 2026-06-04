import { jest } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import Advogado from '../../src/models/Advogado';
import { authMiddleware, generateToken } from '../../src/middleware/auth';

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

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
  },
}));

const mockedFindByPk = Advogado.findByPk as unknown as jest.Mock;

type MiddlewareResult = {
  req: Request;
  res: Response;
  next: jest.MockedFunction<NextFunction>;
};

function runAuthMiddleware(token: string): Promise<MiddlewareResult> {
  return new Promise((resolve) => {
    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as Request;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(() => {
        resolve({ req, res: res as unknown as Response, next });
        return res;
      }),
    } as unknown as Response;

    const next = jest.fn(() => {
      resolve({ req, res, next });
    }) as jest.MockedFunction<NextFunction>;

    authMiddleware(req, res, next);
  });
}

describe('authMiddleware active account enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts an access token when the backing advogado is active', async () => {
    mockedFindByPk.mockResolvedValue({ id: 'adv-1', ativo: true });
    const token = generateToken({ userId: 'adv-1', advogadoId: 'adv-1', role: 'USER' });

    const { req, res, next } = await runAuthMiddleware(token);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user?.advogadoId).toBe('adv-1');
  });

  it('rejects an access token when the backing advogado has been deactivated', async () => {
    mockedFindByPk.mockResolvedValue({ id: 'adv-1', ativo: false });
    const token = generateToken({ userId: 'adv-1', advogadoId: 'adv-1', role: 'USER' });

    const { res, next } = await runAuthMiddleware(token);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      erro: {
        codigo: 'ACCOUNT_INACTIVE',
        mensagem: 'Conta inativa ou não encontrada.',
      },
    });
  });

  it('does not require an advogado record for system tokens', async () => {
    const token = generateToken({ userId: 'system-worker', role: 'SYSTEM' });

    const { res, next } = await runAuthMiddleware(token);

    expect(mockedFindByPk).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
