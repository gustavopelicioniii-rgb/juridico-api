const UNASSIGNED_ADVOGADO_IDS = new Set([
  '00000000-0000-0000-0000-000000000000',
]);

export class ProcessOwnershipError extends Error {
  public readonly code = 'PROCESS_OWNERSHIP_CONFLICT';
  public readonly statusCode = 403;

  constructor(numeroProcesso: string) {
    super(`Processo ${numeroProcesso} já pertence a outro advogado.`);
    this.name = 'ProcessOwnershipError';
  }
}

const hasAssignedOwner = (advogadoId?: string | null): advogadoId is string =>
  !!advogadoId && !UNASSIGNED_ADVOGADO_IDS.has(advogadoId);

export function assertProcessOwnershipCanBeAssigned(
  existingAdvogadoId: string | null | undefined,
  requestedAdvogadoId: string | null | undefined,
  numeroProcesso: string
): void {
  if (
    hasAssignedOwner(existingAdvogadoId)
    && hasAssignedOwner(requestedAdvogadoId)
    && existingAdvogadoId !== requestedAdvogadoId
  ) {
    throw new ProcessOwnershipError(numeroProcesso);
  }
}

export function isProcessOwnershipError(error: unknown): error is ProcessOwnershipError {
  return error instanceof ProcessOwnershipError
    || (
      typeof error === 'object'
      && error !== null
      && (error as { code?: string }).code === 'PROCESS_OWNERSHIP_CONFLICT'
    );
}
