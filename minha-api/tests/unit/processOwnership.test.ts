import {
  ProcessOwnershipError,
  assertProcessCanBeAssignedToAdvogado,
  shouldAssignProcessAdvogadoId,
} from '../../src/utils/processOwnership';

describe('process ownership guard', () => {
  it('permite atribuir processo sem dono ao advogado solicitado', () => {
    expect(() =>
      assertProcessCanBeAssignedToAdvogado(undefined, 'adv-1', '0001')
    ).not.toThrow();
    expect(shouldAssignProcessAdvogadoId(undefined, 'adv-1')).toBe(true);
  });

  it('permite atualizar processo do mesmo advogado', () => {
    expect(() =>
      assertProcessCanBeAssignedToAdvogado('adv-1', 'adv-1', '0001')
    ).not.toThrow();
    expect(shouldAssignProcessAdvogadoId('adv-1', 'adv-1')).toBe(true);
  });

  it('bloqueia reatribuir processo de outro advogado', () => {
    expect(() =>
      assertProcessCanBeAssignedToAdvogado('adv-1', 'adv-2', '0001')
    ).toThrow(ProcessOwnershipError);
    expect(shouldAssignProcessAdvogadoId('adv-1', 'adv-2')).toBe(false);
  });

  it('preserva dono existente em atualizacoes sem advogado solicitante', () => {
    expect(() =>
      assertProcessCanBeAssignedToAdvogado('adv-1', undefined, '0001')
    ).not.toThrow();
    expect(shouldAssignProcessAdvogadoId('adv-1', undefined)).toBe(false);
  });
});
