import {
  assertProcessoCanBeLinkedToAdvogado,
  PROCESS_OWNERSHIP_CONFLICT,
} from '../../src/services/TribunalService';

jest.mock('../../src/config/redis', () => ({
  __esModule: true,
  cache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
  },
}));

describe('process ownership invariant', () => {
  it('allows linking an unowned process to the requesting advogado', () => {
    expect(() => assertProcessoCanBeLinkedToAdvogado({
      numeroProcesso: '0000001-00.2024.8.26.0100',
      advogadoId: undefined,
    }, 'adv-1')).not.toThrow();
  });

  it('allows refreshing a process for the same advogado', () => {
    expect(() => assertProcessoCanBeLinkedToAdvogado({
      numeroProcesso: '0000001-00.2024.8.26.0100',
      advogadoId: 'adv-1',
    }, 'adv-1')).not.toThrow();
  });

  it('rejects reassigning an existing process to another advogado', () => {
    expect(() => assertProcessoCanBeLinkedToAdvogado({
      numeroProcesso: '0000001-00.2024.8.26.0100',
      advogadoId: 'adv-1',
    }, 'adv-2')).toThrow(PROCESS_OWNERSHIP_CONFLICT);
  });
});
