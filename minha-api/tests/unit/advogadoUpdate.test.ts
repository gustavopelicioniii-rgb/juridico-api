import { buildAdvogadoUpdatePayload } from '../../src/utils/advogadoUpdate';

describe('buildAdvogadoUpdatePayload', () => {
  it('strips status changes from non-elevated updates', () => {
    expect(buildAdvogadoUpdatePayload({
      nome: 'Novo Nome',
      email: 'novo@example.com',
      ativo: true,
    }, false)).toEqual({
      nome: 'Novo Nome',
      email: 'novo@example.com',
    });
  });

  it('keeps status changes for elevated updates', () => {
    expect(buildAdvogadoUpdatePayload({
      nome: 'Novo Nome',
      email: 'novo@example.com',
      ativo: false,
    }, true)).toEqual({
      nome: 'Novo Nome',
      email: 'novo@example.com',
      ativo: false,
    });
  });
});
