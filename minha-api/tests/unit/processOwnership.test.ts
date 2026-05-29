import { canAssociateAdvogadoId } from '../../src/utils/processOwnership';

describe('process ownership invariants', () => {
  it('permite associar um processo sem dono ao advogado solicitante', () => {
    expect(canAssociateAdvogadoId(undefined, 'adv-1')).toBe(true);
    expect(canAssociateAdvogadoId(null, 'adv-1')).toBe(true);
  });

  it('permite manter o mesmo advogado em atualizacoes do processo', () => {
    expect(canAssociateAdvogadoId('adv-1', 'adv-1')).toBe(true);
  });

  it('bloqueia reassociacao de processo pertencente a outro advogado', () => {
    expect(canAssociateAdvogadoId('adv-1', 'adv-2')).toBe(false);
  });

  it('nao associa quando a atualizacao nao informa advogado', () => {
    expect(canAssociateAdvogadoId('adv-1', undefined)).toBe(false);
    expect(canAssociateAdvogadoId(undefined, undefined)).toBe(false);
  });
});
