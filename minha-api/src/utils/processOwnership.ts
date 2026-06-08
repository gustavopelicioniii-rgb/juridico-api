export const PROCESS_OWNERSHIP_CONFLICT_CODE = 'PROCESS_OWNERSHIP_CONFLICT';

export class ProcessOwnershipConflictError extends Error {
  public readonly code = PROCESS_OWNERSHIP_CONFLICT_CODE;
  public readonly status = 403;

  constructor(numeroProcesso: string) {
    super(`Processo ${numeroProcesso} já está vinculado a outro advogado.`);
    this.name = 'ProcessOwnershipConflictError';
  }
}

export function hasProcessOwnershipConflict(
  existingAdvogadoId?: string | null,
  requestedAdvogadoId?: string | null
): boolean {
  return !!existingAdvogadoId && !!requestedAdvogadoId && existingAdvogadoId !== requestedAdvogadoId;
}

export function assertProcessOwnership(
  numeroProcesso: string,
  existingAdvogadoId?: string | null,
  requestedAdvogadoId?: string | null
): void {
  if (hasProcessOwnershipConflict(existingAdvogadoId, requestedAdvogadoId)) {
    throw new ProcessOwnershipConflictError(numeroProcesso);
  }
}
