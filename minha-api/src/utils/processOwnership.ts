export class ProcessOwnershipError extends Error {
  public readonly status = 403;
  public readonly code = 'PROCESS_OWNERSHIP_CONFLICT';

  constructor(numeroProcesso: string) {
    super(`Processo ${numeroProcesso} ja pertence a outro advogado.`);
    this.name = 'ProcessOwnershipError';
  }
}

export const assertProcessCanBeAssignedToAdvogado = (
  existingAdvogadoId: string | null | undefined,
  requestedAdvogadoId: string | null | undefined,
  numeroProcesso: string
): void => {
  if (!requestedAdvogadoId) return;
  if (existingAdvogadoId && existingAdvogadoId !== requestedAdvogadoId) {
    throw new ProcessOwnershipError(numeroProcesso);
  }
};

export const shouldAssignProcessAdvogadoId = (
  existingAdvogadoId: string | null | undefined,
  requestedAdvogadoId: string | null | undefined
): boolean => {
  return !!requestedAdvogadoId && (!existingAdvogadoId || existingAdvogadoId === requestedAdvogadoId);
};
