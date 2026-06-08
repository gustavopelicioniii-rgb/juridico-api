import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import TribunalService from '../../src/services/TribunalService';
import { registry } from '../../src/tribunais';
import { sequelize } from '../../src/config/database';
import Tribunal from '../../src/models/Tribunal';
import Processo from '../../src/models/Processo';
import Parte from '../../src/models/Parte';
import Movimentacao from '../../src/models/Movimentacao';
import Monitoramento from '../../src/models/Monitoramento';
import OABBuscaCache from '../../src/models/OABBuscaCache';
import oabCacheService from '../../src/services/OABCacheService';
import { PROCESS_OWNERSHIP_CONFLICT_CODE } from '../../src/utils/processOwnership';

jest.mock('../../src/tribunais', () => ({
  registry: {
    get: jest.fn(),
    listar: jest.fn(),
  },
}));

jest.mock('../../src/config/database', () => ({
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
    findAll: jest.fn(),
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
    findOne: jest.fn(),
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
  default: {},
}));

jest.mock('../../src/models/OABBuscaCache', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    destroy: jest.fn(),
    upsert: jest.fn(),
  },
}));

jest.mock('../../src/services/OABCacheService', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
  },
}));

jest.mock('../../src/config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const dadosProcesso = {
  numeroProcesso: '0001234-56.2024.8.26.0100',
  tribunalCodigo: 'TJSP',
  classe: 'Procedimento Comum',
  assunto: 'Contrato',
  instancia: 'PRIMEIRA' as const,
  partes: [],
  movimentacoes: [],
  dadosOriginais: {},
};

describe('TribunalService ownership invariants', () => {
  const mockedRegistryGet = registry.get as unknown as jest.Mock;
  const mockedTransaction = sequelize.transaction as unknown as jest.Mock;
  const mockedTribunalFindOne = Tribunal.findOne as unknown as jest.Mock;
  const mockedProcessoFindOne = Processo.findOne as unknown as jest.Mock;
  const mockedProcessoFindAll = Processo.findAll as unknown as jest.Mock;
  const mockedParteDestroy = Parte.destroy as unknown as jest.Mock;
  const mockedMovimentacaoFindOne = Movimentacao.findOne as unknown as jest.Mock;
  const mockedOABCacheFindOne = OABBuscaCache.findOne as unknown as jest.Mock;
  const mockedOABCacheDestroy = OABBuscaCache.destroy as unknown as jest.Mock;
  const mockedOABMemoryGet = oabCacheService.get as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRegistryGet.mockReturnValue({
      buscarProcesso: jest.fn().mockResolvedValue(dadosProcesso as never),
      buscarPorOAB: jest.fn().mockResolvedValue({ processos: [], total: 0 } as never),
    });
    mockedTransaction.mockImplementation(async (callback: any) => callback({ id: 'tx' }));
    mockedTribunalFindOne.mockResolvedValue({ id: 'trib-1', codigo: 'TJSP' } as never);
    mockedMovimentacaoFindOne.mockResolvedValue(null as never);
    (Monitoramento.findOne as unknown as jest.Mock).mockResolvedValue(null as never);
    mockedOABCacheFindOne.mockResolvedValue(null as never);
    mockedOABCacheDestroy.mockResolvedValue(0 as never);
    mockedOABMemoryGet.mockReturnValue(null);
  });

  it('rejects direct import when an existing process belongs to another advogado', async () => {
    const update = jest.fn();
    mockedProcessoFindOne.mockResolvedValue({
      id: 'proc-1',
      numeroProcesso: dadosProcesso.numeroProcesso,
      advogadoId: 'owner-a',
      update,
    } as never);

    await expect(
      TribunalService.buscarESalvarProcesso(dadosProcesso.numeroProcesso, 'TJSP', 'owner-b')
    ).rejects.toMatchObject({ code: PROCESS_OWNERSHIP_CONFLICT_CODE });

    expect(update).not.toHaveBeenCalled();
    expect(mockedParteDestroy).not.toHaveBeenCalled();
  });

  it('preserves an existing owner during unscoped process refresh', async () => {
    const update = jest.fn(async () => undefined);
    mockedProcessoFindOne.mockResolvedValue({
      id: 'proc-1',
      numeroProcesso: dadosProcesso.numeroProcesso,
      advogadoId: 'owner-a',
      classe: 'Antiga',
      assunto: 'Antigo',
      assuntoPrincipal: undefined,
      ultimaMovimentacao: undefined,
      valorCausa: undefined,
      orgaoJulgador: undefined,
      nivelSigilo: undefined,
      update,
    } as never);

    await TribunalService.buscarESalvarProcesso(dadosProcesso.numeroProcesso, 'TJSP');

    expect(update).toHaveBeenCalledWith(
      expect.not.objectContaining({ advogadoId: expect.anything() }),
      expect.any(Object)
    );
  });

  it('skips OAB summary reassignment when the process belongs to another advogado', async () => {
    const update = jest.fn();
    mockedProcessoFindOne.mockResolvedValue({
      id: 'proc-1',
      numeroProcesso: dadosProcesso.numeroProcesso,
      advogadoId: 'owner-a',
      enriquecido: false,
      update,
    } as never);

    const result = await (TribunalService as any).salvarResumoProcessoOAB(
      {
        numeroProcesso: dadosProcesso.numeroProcesso,
        tribunalCodigo: 'TJSP',
      },
      'TJSP',
      'owner-b'
    );

    expect(result).toBe(dadosProcesso.numeroProcesso);
    expect(update).not.toHaveBeenCalled();
    expect(Monitoramento.create).not.toHaveBeenCalled();
  });

  it('hydrates OAB responses only from processes owned by the requesting advogado', async () => {
    const adapter = {
      buscarPorOAB: jest.fn().mockResolvedValue({
        processos: [{
          numeroProcesso: dadosProcesso.numeroProcesso,
          tribunalCodigo: 'TJSP',
          classe: 'Procedimento Comum',
        }],
        total: 1,
      } as never),
      buscarProcesso: jest.fn().mockRejectedValue(new Error('crawler unavailable') as never),
    };
    mockedRegistryGet.mockReturnValue(adapter);
    mockedProcessoFindOne.mockResolvedValue({
      id: 'proc-1',
      numeroProcesso: dadosProcesso.numeroProcesso,
      advogadoId: 'owner-a',
      enriquecido: false,
      update: jest.fn(),
    } as never);
    mockedProcessoFindAll.mockResolvedValue([] as never);

    await TribunalService.buscarPorOABComCache('123456SP', 'TJSP', undefined, 'owner-b');

    expect(mockedProcessoFindAll).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        numeroProcesso: [dadosProcesso.numeroProcesso.replace(/\D/g, '')],
        advogadoId: 'owner-b',
      },
    }));
  });
});
