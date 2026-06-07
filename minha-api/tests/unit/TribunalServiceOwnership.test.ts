import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import TribunalService from '../../src/services/TribunalService';
import { registry } from '../../src/tribunais';
import { sequelize } from '../../src/config/database';
import Tribunal from '../../src/models/Tribunal';
import Processo from '../../src/models/Processo';
import Parte from '../../src/models/Parte';

const mockBuscarProcesso = jest.fn();

jest.mock('../../src/tribunais', () => ({
  __esModule: true,
  registry: {
    get: jest.fn(),
    listar: jest.fn(),
  },
}));

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  sequelize: {
    transaction: jest.fn(),
  },
}));

jest.mock('../../src/models/Tribunal', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

jest.mock('../../src/models/Processo', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('../../src/models/Parte', () => ({
  __esModule: true,
  default: {
    destroy: jest.fn(),
    bulkCreate: jest.fn(),
  },
}));

jest.mock('../../src/models/Movimentacao', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    bulkCreate: jest.fn(),
  },
}));

jest.mock('../../src/models/Monitoramento', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('../../src/models/Job', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
  },
}));

jest.mock('../../src/models/OABBuscaCache', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    upsert: jest.fn(),
  },
}));

jest.mock('../../src/config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/services/OABCacheService', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

describe('TribunalService ownership invariant', () => {
  const mockedRegistryGet = registry.get as unknown as jest.Mock;
  const mockedTransaction = sequelize.transaction as unknown as jest.Mock;
  const mockedTribunalFindOne = Tribunal.findOne as unknown as jest.Mock;
  const mockedProcessoFindOne = Processo.findOne as unknown as jest.Mock;
  const mockedParteDestroy = Parte.destroy as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRegistryGet.mockReturnValue({ buscarProcesso: mockBuscarProcesso });
    (mockedTransaction as any).mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({ id: 'tx' })
    );
    (mockedTribunalFindOne as any).mockResolvedValue({ id: 'trib-1', codigo: 'TJSP' });
    (mockBuscarProcesso as any).mockResolvedValue({
      numeroProcesso: '0000001-00.2024.8.26.0001',
      classe: 'Procedimento',
      assunto: 'Teste',
      instancia: 'PRIMEIRA',
      partes: [],
      movimentacoes: [],
      dadosOriginais: {},
    });
  });

  it('não reassocia processo já pertencente a outro advogado', async () => {
    const update = jest.fn(async () => undefined);
    (mockedProcessoFindOne as any).mockResolvedValue({
      id: 'proc-1',
      numeroProcesso: '0000001-00.2024.8.26.0001',
      advogadoId: 'adv-victim',
      classe: 'Procedimento',
      assunto: 'Teste',
      ultimaMovimentacao: null,
      valorCausa: null,
      orgaoJulgador: null,
      nivelSigilo: null,
      update,
    });

    await expect(
      TribunalService.buscarESalvarProcesso(
        '0000001-00.2024.8.26.0001',
        'TJSP',
        'adv-attacker'
      )
    ).rejects.toMatchObject({
      code: 'PROCESS_OWNERSHIP_CONFLICT',
      statusCode: 403,
    });

    expect(update).not.toHaveBeenCalled();
    expect(mockedParteDestroy).not.toHaveBeenCalled();
  });
});
