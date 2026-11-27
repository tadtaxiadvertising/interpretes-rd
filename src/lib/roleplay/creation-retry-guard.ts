/**
 * A missing server acknowledgement does not prove rollback. A resumed direct
 * attempt retains its existing controller; a new attempt needs an explicit
 * decision after the operator checks existing sessions.
 */
export function confirmRoleplayCreationRetry(
  submissionUncertain: boolean,
  resumingDirectAttempt: boolean,
  confirm: (message: string) => boolean,
): boolean {
  if (!submissionUncertain || resumingDirectAttempt) return true;
  return confirm(
    'El intento anterior podría haber creado un roleplay. Comprueba las sesiones existentes antes de repetir. ' +
    '¿Confirmas que quieres iniciar una nueva creación, aunque exista riesgo de duplicados?',
  );
}
