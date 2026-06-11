type OwnedProcess = {
  numeroProcesso?: string;
  advogadoId?: string | null;
};

export class ProcessOwnershipError extends Error {
  public readonly code = 'PROCESS_OWNERSHIP_CONFLICT';

  constructor(numeroProcesso?: string) {
    super(
      numeroProcesso
        ? `Processo ${numeroProcesso} já está associado a outro advogado.`
        : 'Processo já está associado a outro advogado.'
    );
    this.name = 'ProcessOwnershipError';
  }
}

export function assertProcessCanBeAssociated(
  processo: OwnedProcess,
  advogadoId?: string
): void {
  if (!advogadoId || !processo.advogadoId || processo.advogadoId === advogadoId) {
    return;
  }

  throw new ProcessOwnershipError(processo.numeroProcesso);
}

export function isProcessOwnershipError(error: unknown): error is ProcessOwnershipError {
  return error instanceof ProcessOwnershipError
    || (typeof error === 'object'
      && error !== null
      && (error as { code?: string }).code === 'PROCESS_OWNERSHIP_CONFLICT');
}
