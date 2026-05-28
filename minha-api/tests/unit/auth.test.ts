import { describe, expect, it } from '@jest/globals';
import { canAccessAdvogadoResource, AuthPayload } from '../../src/middleware/auth';

const user = (overrides: Partial<AuthPayload>): AuthPayload => ({
  userId: 'user-1',
  advogadoId: 'adv-1',
  role: 'USER',
  ...overrides,
});

describe('canAccessAdvogadoResource', () => {
  it('permite usuário acessar o próprio advogado', () => {
    expect(canAccessAdvogadoResource(user({}), 'adv-1')).toBe(true);
  });

  it('bloqueia usuário comum tentando acessar outro advogado', () => {
    expect(canAccessAdvogadoResource(user({}), 'adv-2')).toBe(false);
  });

  it('permite papéis administrativos acessarem qualquer advogado', () => {
    expect(canAccessAdvogadoResource(user({ role: 'ADMIN' }), 'adv-2')).toBe(true);
    expect(canAccessAdvogadoResource(user({ role: 'SYSTEM' }), 'adv-2')).toBe(true);
  });
});
