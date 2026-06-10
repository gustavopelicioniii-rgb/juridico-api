import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import Advogado from '../../src/models/Advogado';
import { authMiddleware, generateToken } from '../../src/middleware/auth';
import { isAdminAccount, isReservedAdminCredential } from '../../src/routes/auth';

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
  },
}));

const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve));

describe('auth security invariants', () => {
  const mockedFindByPk = Advogado.findByPk as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_OAB = '361329';
    process.env.ADMIN_EMAIL = 'admin@example.com';
  });

  it('concede ADMIN somente pelo OAB reservado, não por email mutável', () => {
    expect(isAdminAccount('361329')).toBe(true);
    expect(isAdminAccount('999999')).toBe(false);
  });

  it('bloqueia credenciais públicas reservadas para o administrador', () => {
    expect(isReservedAdminCredential('361329', 'user@example.com')).toBe(true);
    expect(isReservedAdminCredential('999999', 'admin@example.com')).toBe(true);
    expect(isReservedAdminCredential('999999', 'user@example.com')).toBe(false);
  });

  it('rejeita token de usuário quando a conta backing está inativa', async () => {
    (mockedFindByPk as any).mockResolvedValue({ id: 'adv-1', ativo: false });

    const token = generateToken({ userId: 'adv-1', advogadoId: 'adv-1', role: 'USER' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json };
    const next = jest.fn();

    authMiddleware(req as any, res as any, next);
    await flushPromises();

    expect(mockedFindByPk).toHaveBeenCalledWith('adv-1');
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      erro: expect.objectContaining({ codigo: 'INVALID_TOKEN' }),
    }));
  });
});
