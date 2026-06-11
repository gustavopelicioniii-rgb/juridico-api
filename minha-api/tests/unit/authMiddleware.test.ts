import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { authMiddleware, generateToken } from '../../src/middleware/auth';
import Advogado from '../../src/models/Advogado';

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
  },
}));

const runMiddleware = async (token: string) => {
  let resolveDone: (value: unknown) => void = () => undefined;
  const done = new Promise(resolve => {
    resolveDone = resolve;
  });

  const req: any = {
    headers: {
      authorization: `Bearer ${token}`,
    },
  };
  const res: any = {
    status: jest.fn(() => res),
    json: jest.fn((body: unknown) => {
      resolveDone(body);
      return res;
    }),
  };
  const next = jest.fn(() => resolveDone('next'));

  authMiddleware(req, res, next);
  await done;

  return { req, res, next };
};

describe('authMiddleware', () => {
  const mockedFindByPk = Advogado.findByPk as unknown as jest.Mock;
  const originalAdminOab = process.env.ADMIN_OAB;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_OAB = 'ADMIN123';
  });

  afterAll(() => {
    process.env.ADMIN_OAB = originalAdminOab;
  });

  it('rejeita token de conta inativa', async () => {
    (mockedFindByPk as any).mockResolvedValue({
      id: 'adv-1',
      oab: 'SP123',
      ativo: false,
    });
    const token = generateToken({ userId: 'adv-1', advogadoId: 'adv-1', role: 'USER' });

    const { res, next } = await runMiddleware(token);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      erro: expect.objectContaining({ codigo: 'INVALID_TOKEN' }),
    }));
  });

  it('recalcula o papel atual da conta ativa', async () => {
    (mockedFindByPk as any).mockResolvedValue({
      id: 'adv-1',
      oab: 'SP123',
      ativo: true,
    });
    const token = generateToken({ userId: 'adv-1', advogadoId: 'adv-1', role: 'ADMIN' });

    const { req, next } = await runMiddleware(token);

    expect(next).toHaveBeenCalled();
    expect(req.user.role).toBe('USER');
    expect(req.user.advogadoId).toBe('adv-1');
  });
});
