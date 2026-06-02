import { Request, Response } from 'express';
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import Advogado from '../../src/models/Advogado';
import { authRouter } from '../../src/routes/auth';

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

type MockResponse = Pick<Response, 'status' | 'json'> & {
  statusCode: number;
  body?: unknown;
};

const getRegisterHandler = () => {
  const layer = (authRouter as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
      };
    }>;
  }).stack.find((entry) => entry.route?.path === '/register' && entry.route.methods.post);

  if (!layer?.route) {
    throw new Error('POST /register route not found');
  }

  return layer.route.stack[0].handle;
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

const callRegister = async (body: Record<string, unknown>) => {
  const req = { body } as Request;
  const res = makeResponse();

  await getRegisterHandler()(req, res as unknown as Response);

  return res;
};

describe('auth routes', () => {
  const mockedFindOne = Advogado.findOne as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('permite recuperar conta bridge sem senha quando o email confere', async () => {
    const update = jest.fn(async (_values: Record<string, unknown>) => undefined);
    const existing = {
      id: 'adv-bridge',
      oab: 'JX123456',
      nome: 'Bridge Owner',
      email: 'owner@example.com',
      passwordHash: undefined,
      update,
    };
    (mockedFindOne as any).mockResolvedValue(existing);

    const res = await callRegister({
      oab: 'jx123456',
      nome: 'Attacker Ignored',
      email: 'OWNER@example.com',
      senha: 'senha-forte',
    });

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      ativo: true,
      email: 'owner@example.com',
      nome: 'Bridge Owner',
      passwordHash: expect.any(String),
    }));
    const [{ passwordHash }] = update.mock.calls[0] as unknown as [{ passwordHash: string }];
    await expect(bcrypt.compare('senha-forte', passwordHash)).resolves.toBe(true);
    expect(res.body).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      advogado: {
        id: 'adv-bridge',
        oab: 'JX123456',
      },
    });
  });

  it('bloqueia tomada de conta bridge sem senha quando o email diverge', async () => {
    const update = jest.fn(async (_values: Record<string, unknown>) => undefined);
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-bridge',
      oab: 'JX123456',
      nome: 'Bridge Owner',
      email: 'owner@example.com',
      passwordHash: undefined,
      update,
    });

    const res = await callRegister({
      oab: 'JX123456',
      nome: 'Mallory',
      email: 'mallory@example.com',
      senha: 'senha-forte',
    });

    expect(res.statusCode).toBe(409);
    expect(update).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      erro: { codigo: 'DUPLICATE_OAB', mensagem: 'Já existe advogado com esta OAB.' },
    });
  });

  it('bloqueia tomada de conta bridge sem senha quando não há email cadastrado', async () => {
    const update = jest.fn(async (_values: Record<string, unknown>) => undefined);
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-bridge',
      oab: 'JX123456',
      nome: 'Bridge Owner',
      email: undefined,
      passwordHash: undefined,
      update,
    });

    const res = await callRegister({
      oab: 'JX123456',
      nome: 'Mallory',
      email: 'mallory@example.com',
      senha: 'senha-forte',
    });

    expect(res.statusCode).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });
});
