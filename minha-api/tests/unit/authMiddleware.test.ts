import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { authMiddleware, generateToken } from '../../src/middleware/auth';
import Advogado from '../../src/models/Advogado';

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
  },
}));

type MiddlewareResult = {
  statusCode?: number;
  body?: any;
  nextCalled: boolean;
};

function invokeAuthMiddleware(token: string): Promise<MiddlewareResult> {
  return new Promise((resolve) => {
    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    } as unknown as Request;

    const result: MiddlewareResult = { nextCalled: false };
    const res = {
      status: jest.fn((code: number) => {
        result.statusCode = code;
        return res;
      }),
      json: jest.fn((payload: unknown) => {
        result.body = payload;
        resolve(result);
        return res;
      }),
    } as unknown as Response;
    const next: NextFunction = jest.fn(() => {
      result.nextCalled = true;
      resolve(result);
    });

    authMiddleware(req, res, next);
  });
}

describe('authMiddleware account status enforcement', () => {
  const mockedFindByPk = Advogado.findByPk as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a valid USER token when the backing advogado is inactive', async () => {
    (mockedFindByPk as any).mockResolvedValue({
      id: 'adv-1',
      ativo: false,
    });
    const token = generateToken({ userId: 'adv-1', advogadoId: 'adv-1', role: 'USER' });

    const result = await invokeAuthMiddleware(token);

    expect(result.nextCalled).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.body.erro.codigo).toBe('ACCOUNT_INACTIVE');
  });

  it('allows a valid USER token when the backing advogado is active', async () => {
    (mockedFindByPk as any).mockResolvedValue({
      id: 'adv-1',
      ativo: true,
    });
    const token = generateToken({ userId: 'adv-1', advogadoId: 'adv-1', role: 'USER' });

    const result = await invokeAuthMiddleware(token);

    expect(result.nextCalled).toBe(true);
    expect(result.statusCode).toBeUndefined();
  });

  it('does not require an advogado row for SYSTEM tokens', async () => {
    const token = generateToken({ userId: 'system-worker', role: 'SYSTEM' });

    const result = await invokeAuthMiddleware(token);

    expect(result.nextCalled).toBe(true);
    expect(mockedFindByPk).not.toHaveBeenCalled();
  });
});
