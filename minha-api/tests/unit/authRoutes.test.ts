import bcrypt from 'bcryptjs';
import { authRouter } from '../../src/routes/auth';
import Advogado from '../../src/models/Advogado';
import { generateToken } from '../../src/middleware/auth';

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    create: jest.fn(),
    findByPk: jest.fn(),
  },
}));

jest.mock('../../src/middleware/auth', () => ({
  __esModule: true,
  generateToken: jest.fn((payload: { role: string; advogadoId: string }) => `access:${payload.role}:${payload.advogadoId}`),
  generateRefreshToken: jest.fn((payload: { role: string; advogadoId: string }) => `refresh:${payload.role}:${payload.advogadoId}`),
  verifyToken: jest.fn(),
  blacklistToken: jest.fn(),
  ensureActiveAuthSubject: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/AdvogadoOnboardingService', () => ({
  __esModule: true,
  default: {
    start: jest.fn(async () => undefined),
  },
}));

const findPostHandler = (path: string) => {
  const layer = (authRouter as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.post);
  if (!layer) {
    throw new Error(`Route not found: POST ${path}`);
  }
  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
};

const mockResponse = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('auth routes security regressions', () => {
  const findOne = Advogado.findOne as jest.Mock;
  const create = Advogado.create as jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_OAB;
    delete process.env.ADMIN_EMAIL;
  });

  it('does not grant ADMIN from public profile email matching ADMIN_EMAIL', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    const passwordHash = await bcrypt.hash('correct-password', 4);
    findOne.mockResolvedValue({
      id: 'adv-user',
      oab: 'OAB123',
      nome: 'Regular User',
      email: 'admin@example.com',
      passwordHash,
      ativo: true,
    });

    const handler = findPostHandler('/login');
    const res = mockResponse();

    await handler({ body: { email: 'admin@example.com', senha: 'correct-password' } }, res);

    expect(generateToken).toHaveBeenCalledWith(expect.objectContaining({ role: 'USER', advogadoId: 'adv-user' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'access:USER:adv-user' }));
  });

  it('rejects public registration using reserved admin credentials', async () => {
    process.env.ADMIN_OAB = 'ADMIN123';
    process.env.ADMIN_EMAIL = 'admin@example.com';
    const handler = findPostHandler('/register');
    const res = mockResponse();

    await handler({
      body: {
        oab: 'ADMIN123',
        nome: 'Attacker',
        email: 'attacker@example.com',
        senha: 'long-enough-password',
      },
    }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not recover a bridge account when the submitted email differs', async () => {
    const update = jest.fn();
    findOne.mockResolvedValue({
      id: 'bridge-1',
      oab: 'JX123',
      nome: 'Bridge Owner',
      email: 'owner@example.com',
      passwordHash: undefined,
      ativo: true,
      update,
    });
    const handler = findPostHandler('/register');
    const res = mockResponse();

    await handler({
      body: {
        oab: 'jx123',
        nome: 'Attacker',
        email: 'attacker@example.com',
        senha: 'long-enough-password',
      },
    }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(update).not.toHaveBeenCalled();
  });

  it('recovers a passwordless bridge account only when the stored email matches', async () => {
    const update = jest.fn(async () => undefined);
    findOne.mockResolvedValue({
      id: 'bridge-1',
      oab: 'JX123',
      nome: 'Bridge Owner',
      email: 'owner@example.com',
      passwordHash: undefined,
      ativo: true,
      update,
    });
    const handler = findPostHandler('/register');
    const res = mockResponse();

    await handler({
      body: {
        oab: 'jx123',
        nome: 'Bridge Owner',
        email: 'OWNER@example.com',
        senha: 'long-enough-password',
      },
    }, res);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      passwordHash: expect.any(String),
      email: 'owner@example.com',
      ativo: true,
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'access:USER:bridge-1' }));
  });

});
