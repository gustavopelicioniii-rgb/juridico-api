import express from 'express';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { authRouter } from '../../src/routes/auth';
import Advogado from '../../src/models/Advogado';

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  },
}));

const startAuthServer = async (): Promise<{ server: Server; baseUrl: string }> => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);

  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

const postRegister = async (baseUrl: string, body: Record<string, unknown>) => {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: await response.json() as { erro?: { codigo?: string } },
  };
};

describe('auth routes', () => {
  const mockedFindOne = Advogado.findOne as unknown as jest.Mock;
  const originalAdminOab = process.env.ADMIN_OAB;
  const originalAdminEmail = process.env.ADMIN_EMAIL;
  let server: Server | undefined;
  let baseUrl = '';

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.ADMIN_OAB = 'ADMIN123';
    process.env.ADMIN_EMAIL = 'admin@example.com';
    const started = await startAuthServer();
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    process.env.ADMIN_OAB = originalAdminOab;
    process.env.ADMIN_EMAIL = originalAdminEmail;
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(error => error ? reject(error) : resolve());
    });
  });

  it('não permite cadastro público reivindicar conta bridge sem senha', async () => {
    const update = jest.fn();
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-bridge',
      oab: 'JX123',
      nome: 'Bridge',
      email: 'owner@example.com',
      passwordHash: null,
      update,
    });

    const response = await postRegister(baseUrl, {
      oab: 'JX123',
      nome: 'Attacker',
      email: 'attacker@example.com',
      senha: 'senha-forte',
    });

    expect(response.status).toBe(409);
    expect(response.body.erro?.codigo).toBe('DUPLICATE_OAB');
    expect(update).not.toHaveBeenCalled();
  });

  it('bloqueia cadastro público com credenciais administrativas reservadas', async () => {
    const response = await postRegister(baseUrl, {
      oab: 'SP99999',
      nome: 'Attacker',
      email: 'admin@example.com',
      senha: 'senha-forte',
    });

    expect(response.status).toBe(403);
    expect(response.body.erro?.codigo).toBe('RESERVED_ADMIN_CREDENTIALS');
    expect(mockedFindOne).not.toHaveBeenCalled();
  });
});
