import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Advogado from '../../src/models/Advogado';
import { authRouter } from '../../src/routes/auth';

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('../../src/services/AdvogadoOnboardingService', () => ({
  __esModule: true,
  default: {
    start: jest.fn(),
  },
}));

const mockedFindOne = Advogado.findOne as unknown as jest.Mock;
const mockedCreate = Advogado.create as unknown as jest.Mock;

type JsonResponse = {
  status: number;
  body: any;
};

const postJson = async (path: string, body: unknown): Promise<JsonResponse> => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);

  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));

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
};

describe('auth routes', () => {
  const originalAdminOab = process.env.ADMIN_OAB;
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_OAB = 'SP123456';
    process.env.ADMIN_EMAIL = 'admin@example.com';
  });

  afterEach(() => {
    process.env.ADMIN_OAB = originalAdminOab;
    process.env.ADMIN_EMAIL = originalAdminEmail;
  });

  it('rejects public registration for passwordless JX bridge accounts without mutating them', async () => {
    const update = jest.fn(async () => undefined);
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-bridge',
      oab: 'JX001',
      nome: 'Bridge Account',
      email: 'victim@example.com',
      ativo: true,
      passwordHash: undefined,
      update,
    });

    const result = await postJson('/auth/register', {
      oab: 'jx001',
      nome: 'Attacker',
      email: 'attacker@example.com',
      senha: 'senha-forte',
    });

    expect(result.status).toBe(409);
    expect(result.body.erro.codigo).toBe('DUPLICATE_OAB');
    expect(update).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects public registration using reserved admin credentials', async () => {
    (mockedFindOne as any).mockResolvedValue(null);

    const byOab = await postJson('/auth/register', {
      oab: 'sp123456',
      nome: 'Impostor',
      email: 'other@example.com',
      senha: 'senha-forte',
    });

    const byEmail = await postJson('/auth/register', {
      oab: 'SP999999',
      nome: 'Impostor',
      email: 'admin@example.com',
      senha: 'senha-forte',
    });

    expect(byOab.status).toBe(403);
    expect(byOab.body.erro.codigo).toBe('RESERVED_ADMIN_CREDENTIAL');
    expect(byEmail.status).toBe(403);
    expect(byEmail.body.erro.codigo).toBe('RESERVED_ADMIN_CREDENTIAL');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('does not grant ADMIN when only ADMIN_EMAIL matches a user account', async () => {
    const passwordHash = await bcrypt.hash('senha-forte', 12);
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-user',
      oab: 'SP999999',
      nome: 'Regular User',
      email: 'admin@example.com',
      ativo: true,
      passwordHash,
    });

    const result = await postJson('/auth/login', {
      oab: 'SP999999',
      senha: 'senha-forte',
    });

    expect(result.status).toBe(200);
    const decoded = jwt.verify(result.body.accessToken, process.env.JWT_SECRET!) as jwt.JwtPayload;
    expect(decoded.role).toBe('USER');
  });

  it('grants ADMIN only when configured admin OAB and email both match', async () => {
    const passwordHash = await bcrypt.hash('senha-forte', 12);
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-admin',
      oab: 'SP123456',
      nome: 'Admin User',
      email: 'admin@example.com',
      ativo: true,
      passwordHash,
    });

    const result = await postJson('/auth/login', {
      oab: 'SP123456',
      senha: 'senha-forte',
    });

    expect(result.status).toBe(200);
    const decoded = jwt.verify(result.body.accessToken, process.env.JWT_SECRET!) as jwt.JwtPayload;
    expect(decoded.role).toBe('ADMIN');
  });
});
