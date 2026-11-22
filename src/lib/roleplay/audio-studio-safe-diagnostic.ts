/**
 * Whitelisted, non-sensitive Audio Studio preflight summary for an admin to
 * share with support. Do not add raw configuration or error messages here.
 */
export function formatAudioStudioSafeDiagnostic(status: {
  encryptionReady: boolean;
  credentialUsable: boolean;
  tokenSource: string;
  integrationEnabled: boolean;
  organizationId: string;
}): string {
  const yesNo = (value: boolean) => value ? 'sí' : 'no';
  const source = status.tokenSource === 'panel' || status.tokenSource === 'servidor'
    || status.tokenSource === 'ninguna' ? status.tokenSource : 'desconocido';
  const organizationConfigured = /^\d{1,30}$/.test(status.organizationId);
  return [
    'Intérpretes RD — Diagnóstico seguro de Audio Studio',
    `Cifrado disponible en Next.js: ${yesNo(status.encryptionReady)}`,
    `Credencial HappyScribe utilizable: ${yesNo(status.credentialUsable)}`,
    `Origen de credencial: ${source}`,
    `Integración habilitada: ${yesNo(status.integrationEnabled)}`,
    `Organización numérica configurada: ${yesNo(organizationConfigured)}`,
    'Estado de la última configuración cargada (no incluye cambios sin guardar).',
    'No contiene tokens, claves, ciphertext, ID de organización ni URLs privadas.',
  ].join('\n');
}
