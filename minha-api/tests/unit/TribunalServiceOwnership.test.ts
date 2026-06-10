import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import TribunalService, { ProcessOwnershipConflictError } from '../../src/services/TribunalService';
import { registry } from '../../src/tribunais';
import Tribunal from '../../src/models/Tribunal';
import Processo from '../../src/models/Processo';
import Parte from '../../src/models/Parte';
import Movimentacao from '../../src/models/Movimentacao';
import OABBuscaCache from '../../src/models/OABBuscaCache';
import oabCacheService from '../../src/services/OABCacheService';

jest.mock('../../src/config/database', () => ({
  sequelize: {
    transaction: jest.fn(async (callback: (transaction: unknown) => unknown) => callback({ id: 'tx' })),
  },
}));

jest.mock('../../src/tribunais', () => ({
  registry: {
    get: jest.fn(),
    listar: jest.fn(),
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

describe('TribunalService ownership isolation', () => {
  const mockedRegistryGet = registry.get as unknown as jest.Mock;
  const mockedTribunalFindOne = Tribunal.findOne as unknown as jest.Mock;
  const mockedProcessoFindOne = Processo.findOne as unknown as jest.Mock;
  const mockedProcessoFindAll = Processo.findAll as unknown as jest.Mock;
  const mockedParteDestroy = Parte.destroy as unknown as jest.Mock;
  const mockedMovimentacaoFindOne = Movimentacao.findOne as unknown as jest.Mock;
  const mockedOabCacheGet = oabCacheService.get as unknown as jest.Mock;
  const mockedOabBuscaFindOne = OABBuscaCache.findOne as unknown as jest.Mock;

  const processoExistente = () => ({
    id: 'proc-1',
    numeroProcesso: '0000001-00.2026.8.26.0001',
    advogadoId: 'adv-owner',
    classe: 'Classe original',
    assunto: 'Assunto original',
    assuntoPrincipal: 'Assunto principal',
    ultimaMovimentacao: new Date('2026-01-01T00:00:00.000Z'),
    valorCausa: 100,
    orgaoJulgador: 'Vara original',
    nivelSigilo: 0,
    enriquecido: true,
    update: jest.fn(),
  });

  const dadosProcesso = {
    numeroProcesso: '0000001-00.2026.8.26.0001',
    classe: 'Classe nova',
    assunto: 'Assunto novo',
    assuntoPrincipal: 'Assunto principal novo',
    instancia: 'PRIMEIRA' as const,
    valorCausa: 200,
    orgaoJulgador: 'Vara nova',
    nivelSigilo: 0,
    partes: [{ nome: 'Parte sensível', tipo: 'AUTOR' as const, isAdvogado: false }],
    movimentacoes: [{ data: new Date('2026-02-01T00:00:00.000Z'), descricao: 'Movimento sigiloso' }],
    dadosOriginais: { source: 'test' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedTribunalFindOne.mockResolvedValue({ id: 'trib-1', codigo: 'TJSP' } as never);
    mockedMovimentacaoFindOne.mockResolvedValue(null as never);
    mockedOabCacheGet.mockReturnValue(undefined);
    mockedOabBuscaFindOne.mockResolvedValue(null as never);
    mockedRegistryGet.mockReturnValue({
      buscarProcesso: jest.fn(async () => dadosProcesso),
      buscarPorOAB: jest.fn(async () => ({
        processos: [{
          numeroProcesso: dadosProcesso.numeroProcesso,
          classe: dadosProcesso.classe,
          partes: dadosProcesso.partes,
          movimentacoes: dadosProcesso.movimentacoes,
        }],
        fontes: [],
      })),
    });
  });

  it('bloqueia importação direta que tentaria transferir processo de outro advogado', async () => {
    const existing = processoExistente();
    mockedProcessoFindOne.mockResolvedValue(existing as never);

    await expect(
      TribunalService.buscarESalvarProcesso(
        dadosProcesso.numeroProcesso,
        'TJSP',
        'adv-attacker'
      )
    ).rejects.toBeInstanceOf(ProcessOwnershipConflictError);

    expect(existing.update).not.toHaveBeenCalled();
    expect(mockedParteDestroy).not.toHaveBeenCalled();
  });

  it('não vaza dados persistidos de outro advogado na resposta de busca por OAB', async () => {
    const existing = processoExistente();
    mockedProcessoFindOne.mockResolvedValue(existing as never);
    mockedProcessoFindAll.mockResolvedValue([] as never);

    const resultado = await TribunalService.buscarPorOABComCache(
      'SP123456',
      'TJSP',
      'Advogado Teste',
      'adv-attacker',
      true
    );

    expect(existing.update).not.toHaveBeenCalled();
    expect(mockedProcessoFindAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        numeroProcesso: [dadosProcesso.numeroProcesso.replace(/\D/g, '')],
        advogadoId: 'adv-attacker',
      }),
    }));
    expect(resultado.processos).toHaveLength(1);
    expect(resultado.processos[0]).toEqual(expect.objectContaining({
      numeroProcesso: dadosProcesso.numeroProcesso,
      id: undefined,
      enriquecido: false,
    }));
    expect(resultado.processos[0].partes?.[0]?.nome).toBe('Parte sensível');
  });
});
