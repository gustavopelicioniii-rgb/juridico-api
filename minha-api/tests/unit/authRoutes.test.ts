import { jest } from '@jest/globals';
import express from 'express';
import { Server } from 'http';
import { AddressInfo } from 'net';
import Advogado from '../../src/models/Advogado';
import { authRouter } from '../../src/routes/auth';
import { generateRefreshToken } from '../../src/middleware/auth';

jest.mock('../../src/config/redis', () => ({
  cache: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
  },
}));

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
const mockedCreate = Advogado.create as unknown as jest.Mock;

async function postJson(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);

  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
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
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('auth routes security invariants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not let an arbitrary email claim a passwordless bridge account', async () => {
    const update = jest.fn(async () => undefined);
    mockedFindOne.mockResolvedValue({
      id: 'adv-bridge',
      oab: 'JX123',
      nome: 'Bridge Account',
      email: 'owner@example.com',
      passwordHash: null,
      update,
    });

    const response = await postJson('/auth/register', {
      oab: 'JX123',
      nome: 'Attacker',
      email: 'attacker@example.com',
      senha: 'very-strong-password',
    });

    expect(response.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('allows a passwordless bridge account to be recovered by its existing email', async () => {
    const update = jest.fn(async () => undefined);
    mockedFindOne.mockResolvedValue({
      id: 'adv-bridge',
      oab: 'JX123',
      nome: 'Bridge Account',
      email: 'owner@example.com',
      passwordHash: null,
      update,
    });

    const response = await postJson('/auth/register', {
      oab: 'JX123',
      nome: 'Bridge Account',
      email: 'OWNER@example.com',
      senha: 'very-strong-password',
    });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      passwordHash: expect.any(String),
      ativo: true,
    }));
    expect(response.body.accessToken).toEqual(expect.any(String));
  });

  it('refuses to refresh tokens for a deactivated advogado', async () => {
    mockedFindByPk.mockResolvedValue({ id: 'adv-1', ativo: false });
    const refreshToken = generateRefreshToken({
      userId: 'adv-1',
      advogadoId: 'adv-1',
      role: 'USER',
    });

    const response = await postJson('/auth/refresh', { refreshToken });

    expect(response.status).toBe(401);
    expect(response.body.erro.codigo).toBe('INVALID_REFRESH_TOKEN');
  });
});
