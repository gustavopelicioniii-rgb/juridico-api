import { resolveScopedAdvogadoIdForActor } from '../../src/utils/tenantScope';

describe('tenant scope authorization', () => {
  it('permite USER acessar apenas o próprio advogadoId', () => {
    const ok = resolveScopedAdvogadoIdForActor(
      { role: 'USER', advogadoId: 'adv-1', userId: 'adv-1' },
      'adv-1'
    );

    expect(ok).toEqual({ ok: true, advogadoId: 'adv-1' });
  });

  it('bloqueia USER tentando acessar outro advogadoId', () => {
    const denied = resolveScopedAdvogadoIdForActor(
      { role: 'USER', advogadoId: 'adv-1', userId: 'adv-1' },
      'adv-2'
    );

    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.status).toBe(403);
    }
  });

  it('permite ADMIN escopo global', () => {
    const admin = resolveScopedAdvogadoIdForActor(
      { role: 'ADMIN', userId: 'admin-1' },
      'adv-2'
    );

    expect(admin).toEqual({ ok: true, advogadoId: 'adv-2' });
  });
});

