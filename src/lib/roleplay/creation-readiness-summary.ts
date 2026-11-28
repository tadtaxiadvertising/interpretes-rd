import type { DirectCatalogDiagnostic } from './direct-upload-catalog-readiness';
import type { DirectRolloutMetadata } from './direct-upload-rollout-inspection';
import type { readDirectUploadPilotConfig } from './direct-upload-pilot-config';
import type { readCreationPilotConfig } from './creation-pilot-config';

type State = 'recognized' | 'review' | 'unchecked';
type Check = { id: string; label: string; state: State; action: string };

export function summarizeCreationReadiness(input: {
  pilot: ReturnType<typeof readCreationPilotConfig>;
  direct: ReturnType<typeof readDirectUploadPilotConfig>;
  buildId: string | null;
  ready: boolean | null;
  catalog: DirectCatalogDiagnostic | null;
  rollout: DirectRolloutMetadata | null;
  rolloutRequested: boolean;
}) {
  const { pilot, direct, buildId, ready, catalog, rollout, rolloutRequested } = input;
  const checked = (value: boolean | null): State => value === null ? 'unchecked' : value ? 'recognized' : 'review';
  const checks: Check[] = [
    { id: 'build', label: 'Identificación del servicio', state: checked(Boolean(buildId)), action: 'Contrasta el SHA con el despliegue esperado y verifica la identidad del proyecto.' },
    { id: 'config', label: 'Variables de subida directa', state: checked(direct.environmentValuesPresent), action: 'Revisa las variables que faltan en la configuración del servicio, sin compartir sus valores.' },
    { id: 'receipt', label: 'Registro de idempotencia', state: checked(ready), action: 'Comprueba el catálogo y los permisos de recuperación antes de repetir una creación incierta.' },
    { id: 'reservation', label: 'Catálogo de reservas', state: checked(catalog ? catalog.reservation === 'catalog-ready' : null), action: 'Revisa la estructura y las restricciones del registro de reservas.' },
    { id: 'permission', label: 'Permisos de registros internos', state: checked(catalog ? catalog.permissions.state === 'recognized' : null), action: 'Revisa los permisos efectivos del servicio y el aislamiento de los roles públicos.' },
    { id: 'budget', label: 'Capacidad contable de subida', state: checked(catalog ? Boolean(catalog.capacity && catalog.capacity.remainingSlots > 0) : null), action: 'Revisa la contabilidad y el espacio real antes de asignar capacidad. No liberes cargos automáticamente.' },
    { id: 'schema', label: 'Estructura de publicación y apertura', state: checked(rollout ? rollout.schemaMetadataReady : rolloutRequested ? false : null), action: 'Revisa las tablas, columnas y disparadores pendientes; no apliques cambios desde esta pantalla.' },
    { id: 'buckets', label: 'Metadatos de buckets privados', state: checked(rollout ? rollout.buckets.length === 2 && ['roleplay-audio-private', 'roleplay-opening-private'].every(id => rollout.buckets.some(b => b.id === id && b.state === 'metadata-ready')) : rolloutRequested ? false : null), action: 'Revisa los límites, formatos y privacidad de los buckets. No sustituyas la validación de políticas por metadatos.' },
  ];
  const externalChecks = [
    'Confirmar proyecto, versión desplegada y configuración del navegador compilado.',
    'Validar políticas efectivas, credenciales, capacidad real y operaciones de Storage en el entorno autorizado.',
    'Revisar el procedimiento de recuperación, las pruebas del piloto y la autorización explícita de activación.',
  ];
  return {
    checks,
    recognized: checks.filter(c => c.state === 'recognized').length,
    review: checks.filter(c => c.state === 'review').length,
    unchecked: checks.filter(c => c.state === 'unchecked').length,
    externalChecks,
    flagsConfigured: direct.formConfigured,
    recoveryConfigured: pilot.receiptsEnabled,
    activationAuthorized: false as const,
  };
}
