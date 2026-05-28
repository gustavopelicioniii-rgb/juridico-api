import { AuthPayload } from '../middleware/auth';

type ScopeOk = { ok: true; advogadoId?: string };
type ScopeError = { ok: false; status: number; body: unknown };

export type ScopeResult = ScopeOk | ScopeError;

export const isElevatedRole = (role?: AuthPayload['role']): boolean =>
  role === 'ADMIN' || role === 'SYSTEM';

export const getActorAdvogadoId = (actor?: Partial<AuthPayload>): string | null =>
  actor?.advogadoId || actor?.userId || null;

export const resolveScopedAdvogadoIdForActor = (
  actor: Partial<AuthPayload> | undefined,
  requestedAdvogadoId?: string | null
): ScopeResult => {
  if (isElevatedRole(actor?.role)) {
    return { ok: true, advogadoId: requestedAdvogadoId || undefined };
  }

  const actorAdvogadoId = getActorAdvogadoId(actor);
  if (!actorAdvogadoId) {
    return {
      ok: false,
      status: 401,
      body: { erro: { codigo: 'UNAUTHORIZED', mensagem: 'Usuário sem escopo de advogado.' } },
    };
  }

  if (requestedAdvogadoId && requestedAdvogadoId !== actorAdvogadoId) {
    return {
      ok: false,
      status: 403,
      body: { erro: { codigo: 'FORBIDDEN', mensagem: 'Acesso negado ao escopo de outro advogado.' } },
    };
  }

  return { ok: true, advogadoId: actorAdvogadoId };
};

