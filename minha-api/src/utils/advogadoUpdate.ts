export interface AdvogadoUpdateInput {
  nome?: string;
  email?: string;
  ativo?: boolean;
}

export interface AdvogadoUpdatePayload {
  nome?: string;
  email?: string;
  ativo?: boolean;
}

export function buildAdvogadoUpdatePayload(
  input: AdvogadoUpdateInput,
  canUpdateStatus: boolean
): AdvogadoUpdatePayload {
  const update: AdvogadoUpdatePayload = {
    nome: input.nome,
    email: input.email,
  };

  if (canUpdateStatus && typeof input.ativo === 'boolean') {
    update.ativo = input.ativo;
  }

  return update;
}
