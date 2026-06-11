import {
  ProcessOwnershipError,
  assertProcessCanBeAssociated,
} from '../../src/utils/processOwnership';

describe('process ownership guard', () => {
  it('permite associar processo sem dono ou do mesmo advogado', () => {
    expect(() => assertProcessCanBeAssociated({ numeroProcesso: '1' }, 'adv-1')).not.toThrow();
    expect(() => assertProcessCanBeAssociated({
      numeroProcesso: '1',
      advogadoId: 'adv-1',
    }, 'adv-1')).not.toThrow();
  });

  it('bloqueia reassociação de processo de outro advogado', () => {
    expect(() => assertProcessCanBeAssociated({
      numeroProcesso: '1',
      advogadoId: 'adv-1',
    }, 'adv-2')).toThrow(ProcessOwnershipError);
  });
});
