import { describe, expect, it } from '@jest/globals';
import { buildAdvogadoUpdatePayload } from '../../src/utils/advogadoUpdate';

describe('buildAdvogadoUpdatePayload', () => {
  it('removes ativo from non-admin updates', () => {
    expect(buildAdvogadoUpdatePayload({
      nome: 'Novo Nome',
      email: 'novo@example.com',
      ativo: true,
    }, false)).toEqual({
      nome: 'Novo Nome',
      email: 'novo@example.com',
    });
  });

  it('keeps ativo for admin updates', () => {
    expect(buildAdvogadoUpdatePayload({
      nome: 'Novo Nome',
      ativo: false,
    }, true)).toEqual({
      nome: 'Novo Nome',
      ativo: false,
    });
  });
});
