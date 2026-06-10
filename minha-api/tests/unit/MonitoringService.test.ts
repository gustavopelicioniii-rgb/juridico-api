import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import MonitoringService from '../../src/services/MonitoringService';
import { agendarScraping } from '../../src/queues';
import Processo from '../../src/models/Processo';
import Tribunal from '../../src/models/Tribunal';
import Movimentacao from '../../src/models/Movimentacao';

jest.mock('../../src/queues', () => ({
  agendarScraping: jest.fn(),
}));

jest.mock('../../src/models/Monitoramento', () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('../../src/models/Processo', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
    findAll: jest.fn(),
  },
}));

jest.mock('../../src/models/Tribunal', () => ({
  __esModule: true,
  default: {
    findByPk: jest.fn(),
  },
}));

jest.mock('../../src/models/Movimentacao', () => ({
  __esModule: true,
  default: {
    count: jest.fn(),
  },
}));

jest.mock('../../src/config/redis', () => ({
  cache: {
    setnx: jest.fn(),
    del: jest.fn(),
  },
}));

describe('MonitoringService polling enqueue safety', () => {
  const mockedAgendarScraping = agendarScraping as unknown as jest.Mock;
  const mockedProcessoFindByPk = Processo.findByPk as unknown as jest.Mock;
  const mockedTribunalFindByPk = Tribunal.findByPk as unknown as jest.Mock;
  const mockedMovimentacaoCount = Movimentacao.count as unknown as jest.Mock;

  const buildMonitoramento = () => ({
    id: 'mon-1',
    processoId: 'proc-1',
    intervaloMinutos: 1,
    ultimoPoll: new Date('2026-01-01T00:00:00.000Z'),
    update: jest.fn(async () => undefined),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedProcessoFindByPk.mockResolvedValue({
      id: 'proc-1',
      numeroProcesso: '0000001-00.2026.8.26.0001',
      tribunalId: 'trib-1',
      advogadoId: 'adv-1',
    } as never);
    mockedTribunalFindByPk.mockResolvedValue({ codigo: 'TJSP' } as never);
    mockedMovimentacaoCount.mockResolvedValue(0 as never);
  });

  it('não avança ultimoPoll quando o enqueue falha', async () => {
    const monitoramento = buildMonitoramento();
    mockedAgendarScraping.mockRejectedValue(new Error('redis down') as never);

    const result = await (MonitoringService as any).processMonitoramento(monitoramento);

    expect(result.sucesso).toBe(false);
    expect(mockedAgendarScraping).toHaveBeenCalled();
    expect(monitoramento.update).not.toHaveBeenCalled();
  });

  it('avança ultimoPoll somente depois de enfileirar com sucesso', async () => {
    const monitoramento = buildMonitoramento();
    mockedAgendarScraping.mockResolvedValue({ id: 'queue-1' } as never);

    const result = await (MonitoringService as any).processMonitoramento(monitoramento);

    expect(result.sucesso).toBe(true);
    expect(monitoramento.update).toHaveBeenCalledWith({ ultimoPoll: expect.any(Date) });
    expect(mockedAgendarScraping.mock.invocationCallOrder[0]).toBeLessThan(
      monitoramento.update.mock.invocationCallOrder[0]
    );
  });
});
