export function canAssociateAdvogadoId(
  existingAdvogadoId?: string | null,
  requestedAdvogadoId?: string | null
): requestedAdvogadoId is string {
  return Boolean(requestedAdvogadoId) && (
    !existingAdvogadoId || existingAdvogadoId === requestedAdvogadoId
  );
}
