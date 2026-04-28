import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import AdvogadoOnboardingService from '../../src/services/AdvogadoOnboardingService';
import Job from '../../src/models/Job';
import ProcessoMonitoramentoService from '../../src/services/ProcessoMonitoramentoService';
import { agendarInitialOABCrawl } from '../../src/queues/ScraperQueue';

jest.mock('../../src/models/Job', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    findAll: jest.fn(),
  },
}));

jest.mock('../../src/services/ProcessoMonitoramentoService', () => ({
  __esModule: true,
  default: {
    cadastrarOABMonitorada: jest.fn(),
  },
}));

jest.mock('../../src/queues/ScraperQueue', () => ({
  __esModule: true,
  agendarInitialOABCrawl: jest.fn(),
}));

describe('AdvogadoOnboardingService', () => {
  const mockedCreate = Job.create as unknown as jest.Mock;
  const mockedFindAll = Job.findAll as unknown as jest.Mock;
  const mockedCadastrarOAB = ProcessoMonitoramentoService.cadastrarOABMonitorada as unknown as jest.Mock;
  const mockedAgendarInitial = agendarInitialOABCrawl as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enfileira onboarding e atualiza job de auditoria', async () => {
    const updateMock = jest.fn(async () => undefined);
    (mockedCreate as any).mockResolvedValue({
      payload: {},
      update: updateMock,
    });
    (mockedFindAll as any).mockResolvedValue([]);
    (mockedAgendarInitial as any).mockResolvedValue({ id: 'queue-123' });
    (mockedCadastrarOAB as any).mockResolvedValue(undefined);

    await AdvogadoOnboardingService.start({
      advogadoId: 'adv-1',
      oab: 'sp12345',
      nome: 'Teste',
      source: 'admin-create',
      requestedBy: 'admin',
    });

    expect(mockedCadastrarOAB).toHaveBeenCalledWith('SP12345', undefined, 5);
    expect(mockedAgendarInitial).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PROCESSANDO',
    }));
  });

  it('retorna status failed quando último job de onboarding falhar', async () => {
    (mockedFindAll as any).mockResolvedValue([
      {
        id: 'audit-1',
        status: 'FALHO',
        erro: 'boom',
        updatedAt: new Date('2026-01-01'),
        payload: {
          mode: 'initial_oab_crawl',
          advogadoId: 'adv-2',
          queueJobId: 'queue-2',
        },
      },
    ]);

    const status = await AdvogadoOnboardingService.getStatusByAdvogadoId('adv-2');

    expect(status.status).toBe('failed');
    expect(status.jobId).toBe('queue-2');
    expect(status.error).toBe('boom');
  });
});
