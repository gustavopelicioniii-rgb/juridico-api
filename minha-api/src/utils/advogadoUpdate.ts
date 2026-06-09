export type AdvogadoUpdateBody = {
  nome?: string;
  email?: string;
  ativo?: boolean;
};

export function buildAdvogadoUpdatePayload(
  body: AdvogadoUpdateBody,
  canUpdateStatus: boolean
): AdvogadoUpdateBody {
  const payload: AdvogadoUpdateBody = {};
  if (body.nome !== undefined) payload.nome = body.nome;
  if (body.email !== undefined) payload.email = body.email;
  if (canUpdateStatus && body.ativo !== undefined) payload.ativo = body.ativo;
  return payload;
}
