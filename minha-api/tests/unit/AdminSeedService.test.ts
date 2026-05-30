import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ensureAdminSeed } from '../../src/services/AdminSeedService';
import Advogado from '../../src/models/Advogado';

jest.mock('../../src/models/Advogado', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

describe('AdminSeedService', () => {
  const mockedFindOne = Advogado.findOne as unknown as jest.Mock;
  const mockedCreate = Advogado.create as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skipa quando faltam credenciais mínimas', async () => {
    const result = await ensureAdminSeed({ oab: '361329' });

    expect(result).toEqual({ skipped: true });
    expect(mockedFindOne).not.toHaveBeenCalled();
  });

  it('atualiza admin existente com nova senha e dados', async () => {
    const update = jest.fn(async () => undefined);
    (mockedFindOne as any).mockResolvedValue({
      id: 'adv-1',
      oab: '361329',
      nome: 'Antigo',
      email: 'old@example.com',
      update,
    });

    const result = await ensureAdminSeed({
      oab: '361329',
      password: 'senha-forte',
      nome: 'Sidney da Silva',
      email: 'sidney@example.com',
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      nome: 'Sidney da Silva',
      email: 'sidney@example.com',
      ativo: true,
      passwordHash: expect.any(String),
    }));
    expect(result.skipped).toBe(false);
    expect(result.created).toBe(false);
    expect(result.advogado?.oab).toBe('361329');
  });

  it('cria admin quando não existe', async () => {
    (mockedFindOne as any).mockResolvedValue(null);
    (mockedCreate as any).mockResolvedValue({
      id: 'adv-2',
      oab: '361329',
      nome: 'Sidney da Silva',
      email: 'sidney@example.com',
    });

    const result = await ensureAdminSeed({
      oab: '361329',
      password: 'senha-forte',
      nome: 'Sidney da Silva',
      email: 'sidney@example.com',
    });

    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({
      oab: '361329',
      nome: 'Sidney da Silva',
      email: 'sidney@example.com',
      ativo: true,
      passwordHash: expect.any(String),
    }));
    expect(result.skipped).toBe(false);
    expect(result.created).toBe(true);
    expect(result.advogado?.id).toBe('adv-2');
  });
});
