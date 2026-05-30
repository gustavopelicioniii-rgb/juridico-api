import { jest } from '@jest/globals';
import { registry } from '../../src/tribunais';
import Tribunal from '../../src/models/Tribunal';
import Processo from '../../src/models/Processo';
import Parte from '../../src/models/Parte';
import Movimentacao from '../../src/models/Movimentacao';
import Monitoramento from '../../src/models/Monitoramento';
import TribunalService from '../../src/services/TribunalService';
import { ProcessOwnershipError } from '../../src/utils/processOwnership';
import { sequelize } from '../../src/config/database';

jest.mock('../../src/tribunais', () => ({
  __esModule: true,
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
    create: jest.fn(),
    findByPk: jest.fn(),
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
    update: jest.fn(),
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
    destroy: jest.fn(),
    findOne: jest.fn(),
    upsert: jest.fn(),
  },
}));

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  sequelize: {
    transaction: jest.fn(),
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
    invalidate: jest.fn(),
  },
}));

const dadosProcesso = {
  numeroProcesso: '0001234-56.2024.8.26.0100',
  tribunalCodigo: 'TJSP',
  classe: 'Procedimento Comum Civel',
  assunto: 'Contrato',
  partes: [],
  movimentacoes: [],
  dadosOriginais: {},
};

describe('TribunalService ownership guard', () => {
  const adapter = {
    buscarProcesso: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (registry.get as jest.Mock).mockReturnValue(adapter);
    (adapter.buscarProcesso as jest.Mock).mockResolvedValue(dadosProcesso);
    (Tribunal.findOne as jest.Mock).mockResolvedValue({ id: 'tribunal-1' });
    (sequelize.transaction as jest.Mock).mockImplementation(async (callback: (t: unknown) => Promise<unknown>) =>
      callback({ id: 'tx' })
    );
    (Parte.destroy as jest.Mock).mockResolvedValue(0);
    (Parte.bulkCreate as jest.Mock).mockResolvedValue([]);
    (Movimentacao.findOne as jest.Mock).mockResolvedValue(null);
    (Movimentacao.bulkCreate as jest.Mock).mockResolvedValue([]);
    (Monitoramento.findOne as jest.Mock).mockResolvedValue(null);
    (Monitoramento.create as jest.Mock).mockResolvedValue({});
  });

  it('bloqueia busca que tentaria reatribuir processo de outro advogado', async () => {
    const update = jest.fn();
    (Processo.findOne as jest.Mock).mockResolvedValue({
      id: 'proc-1',
      numeroProcesso: dadosProcesso.numeroProcesso,
      advogadoId: 'adv-owner',
      classe: undefined,
      assunto: undefined,
      assuntoPrincipal: undefined,
      ultimaMovimentacao: undefined,
      valorCausa: undefined,
      orgaoJulgador: undefined,
      nivelSigilo: undefined,
      update,
    });

    await expect(
      TribunalService.buscarESalvarProcesso(dadosProcesso.numeroProcesso, 'TJSP', 'adv-other')
    ).rejects.toThrow(ProcessOwnershipError);

    expect(update).not.toHaveBeenCalled();
    expect(Parte.destroy).not.toHaveBeenCalled();
    expect(Movimentacao.bulkCreate).not.toHaveBeenCalled();
    expect(Monitoramento.create).not.toHaveBeenCalled();
  });

  it('permite que processo sem dono seja assumido pelo advogado solicitante', async () => {
    const update = jest.fn(async () => undefined);
    (Processo.findOne as jest.Mock).mockResolvedValue({
      id: 'proc-1',
      numeroProcesso: dadosProcesso.numeroProcesso,
      advogadoId: undefined,
      classe: undefined,
      assunto: undefined,
      assuntoPrincipal: undefined,
      ultimaMovimentacao: undefined,
      valorCausa: undefined,
      orgaoJulgador: undefined,
      nivelSigilo: undefined,
      update,
    });

    await TribunalService.buscarESalvarProcesso(dadosProcesso.numeroProcesso, 'TJSP', 'adv-1');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ advogadoId: 'adv-1' }),
      { transaction: { id: 'tx' } }
    );
    expect(Parte.destroy).toHaveBeenCalledWith({
      where: { processoId: 'proc-1' },
      transaction: { id: 'tx' },
    });
    expect(Monitoramento.create).toHaveBeenCalledWith(
      expect.objectContaining({ processoId: 'proc-1', advogadoId: 'adv-1' }),
      { transaction: { id: 'tx' } }
    );
  });
});
