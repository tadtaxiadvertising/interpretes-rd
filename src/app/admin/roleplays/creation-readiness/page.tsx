import Link from 'next/link';
import CopyDiagnostic from './copy-diagnostic';
import SavedReservationLookup from './saved-reservation-lookup';
import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
import { inspectDirectRolloutMetadata } from '@/lib/roleplay/direct-upload-rollout-inspection';
import { inspectDirectUploadCatalog } from '@/lib/roleplay/direct-upload-catalog-readiness';
import { readDirectUploadPilotConfig } from '@/lib/roleplay/direct-upload-pilot-config';
import { readCreationPilotConfig, type CreationPilotMode } from '@/lib/roleplay/creation-pilot-config';
import { isCreationLedgerReady } from '@/lib/roleplay/creation-ledger-readiness';

export const dynamic = 'force-dynamic';

const modeLabels: Record<CreationPilotMode, string> = {
  disabled: 'Piloto desactivado',
  'receipts-only': 'Solo consulta de recibos',
  'blocked-missing-receipts': 'Creación bloqueada: falta recuperación',
  'pilot-configured': 'Ambas opciones configuradas',
};

const modeGuidance: Record<CreationPilotMode, string> = {
  disabled: 'Mantén el flujo tradicional. Comprueba la disponibilidad antes de considerar cualquier activación.',
  'receipts-only': 'Conserva la recuperación de solicitudes anteriores. Las nuevas creaciones con clave siguen desactivadas.',
  'blocked-missing-receipts': 'No uses la creación con clave. Revisa la configuración de recuperación con el responsable del despliegue antes de cualquier cambio.',
  'pilot-configured': 'La configuración por sí sola no confirma que sea seguro crear con clave. Verifica el catálogo y el despliegue antes de utilizar el piloto.',
};

export default async function CreationReadinessPage({
  searchParams,
}: {
  searchParams: Promise<{ check?: string | string[]; checkDirect?: string | string[]; checkRollout?: string | string[] }>;
}) {
  const auth = await validateAction('admin');
  if ('error' in auth || auth.user.role !== 'admin') {
    return <p role="alert" className="text-[var(--theme-danger)]">Acceso restringido a administradores.</p>;
  }

  const pilot = readCreationPilotConfig(process.env);
  const direct = readDirectUploadPilotConfig(process.env);
  const sha = process.env.GIT_SHA?.trim() ?? '';
  const buildId = /^[a-f0-9]{40}$/i.test(sha) ? sha.toLowerCase() : null;
  // No catalog query on initial visit, link prefetch, or malformed request.
  // A refresh with check=1 repeats the bounded, read-only runtime check.
  const params = await searchParams;
  const requested = params.check === '1';
  const directRequested = params.checkDirect === '1';
  const rolloutRequested = params.checkRollout === '1';
  const ready = requested ? await isCreationLedgerReady(prisma) : null;
  const directCatalog = directRequested ? await inspectDirectUploadCatalog(prisma) : null;
  const rollout = rolloutRequested ? await inspectDirectRolloutMetadata(prisma) : null;
  const reservationLabels = { absent: 'Ausente', incomplete: 'Incompleto', 'catalog-ready': 'Estructura reconocida', unavailable: 'No disponible' } as const;
  const permissionLabels = { recognized: 'Permisos reconocidos', 'review-required': 'Requiere revisión de permisos', unavailable: 'No disponible' } as const;
  const budgetLabels = { absent: 'Ausente', incomplete: 'Incompleto', 'accounting-consistent': 'Contabilidad coherente', 'review-required': 'Requiere revisión', unavailable: 'No disponible' } as const;

  // Record when this check finished, not a build timestamp or an approval.
  // Only fixed labels and validated build metadata enter the evidence.
  const metadataLabels: Record<string, string> = { 'present-private': 'Estructura privada reconocida', 'metadata-ready': 'Metadatos reconocidos', 'review-required': 'Requiere revisión', missing: 'Ausente' };
  const evidence = ready === null && !directRequested && !rolloutRequested ? null : [
    'Diagnóstico de creación segura — Intérpretes RD',
    'Fecha de comprobación (UTC): ' + new Date().toISOString(),
    'SHA del servicio: ' + (buildId ?? 'No informado'),
    'Modo: ' + pilot.mode,
    'Registro de idempotencia: ' + (ready === null ? 'No comprobado' : ready ? 'Disponible según comprobación' : 'No disponible según comprobación'),
    'Subida directa: ' + (direct.formConfigured ? 'Banderas configuradas' : 'Banderas incompletas'),
    'Variables de subida directa: ' + (direct.environmentValuesPresent ? 'Presentes en el servicio' : 'Faltan valores'),
    'Consulta de reservas directas: ' + (direct.reservationLookupConfigured ? 'Configurada' : 'Desactivada'),
    'Catálogo de reservas: ' + (directCatalog ? reservationLabels[directCatalog.reservation] : 'No comprobado'),
    'Presupuesto de objetos: ' + (directCatalog ? budgetLabels[directCatalog.budget] : 'No comprobado'),
    ...(directCatalog?.capacity ? ['Cupos contables: ' + directCatalog.capacity.allocatedSlots + ' de ' + directCatalog.capacity.maxSlots + '; restantes: ' + directCatalog.capacity.remainingSlots] : []),
    'Permisos de registros internos: ' + (directCatalog ? permissionLabels[directCatalog.permissions.state] : 'No comprobados'),
    'Estructura de publicación y apertura: ' + (rollout ? rollout.schemaMetadataReady ? 'Metadatos reconocidos' : 'Requiere revisión' : rolloutRequested ? 'No disponible' : 'No comprobada'),
    ...(rollout ? rollout.buckets.map(bucket => 'Bucket ' + bucket.id + ': ' + metadataLabels[bucket.state]) : []),
    'Subida directa: acceso real a Storage, políticas efectivas de objetos y configuración del navegador no comprobados.',
    'Resultado puntual; no autoriza activar el piloto.',
  ].join('\n');

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <Link href="/admin/roleplays" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--theme-link)] underline">Volver a roleplays</Link>
      <header>
        <h1 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">Diagnóstico de creación segura</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">Comprueba la configuración y el registro de solicitudes del servicio actual sin crear sesiones ni modificar PostgreSQL.</p>
      </header>
      <section aria-label="Configuración actual" className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
        <h2 className="font-semibold text-[var(--foreground)]">Configuración del piloto</h2>
        <p className="text-sm font-medium text-[var(--foreground)]">{modeLabels[pilot.mode]}</p>
        <p className="text-sm text-[var(--text-secondary)]">{modeGuidance[pilot.mode]}</p>
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--text-secondary)]">Creación con clave</dt><dd className="font-medium text-[var(--foreground)]">{pilot.keyedCreationEnabled ? 'Configurada' : 'Desactivada'}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--text-secondary)]">Consulta de recibos</dt><dd className="font-medium text-[var(--foreground)]">{pilot.receiptsEnabled ? 'Configurada' : 'Desactivada'}</dd></div>
          <div className="space-y-1"><dt className="text-[var(--text-secondary)]">SHA del servicio Next.js</dt><dd className="break-all font-mono text-xs text-[var(--foreground)]">{buildId ?? 'No informado por el despliegue'}</dd></div>
        </dl>
      </section>
      <section aria-label="Disponibilidad PostgreSQL" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
        <h2 className="font-semibold text-[var(--foreground)]">Registro de idempotencia</h2>
        <p role="status" className={ready === true ? 'text-sm text-[var(--theme-success)]' : ready === false ? 'text-sm text-[var(--theme-warning)]' : 'text-sm text-[var(--text-secondary)]'}>
          {ready === null ? 'Comprobación no ejecutada.' : ready ? 'Catálogo reforzado y permisos efectivos reconocidos.' : 'No disponible: el catálogo, los permisos o la conexión no cumplen la comprobación.'}
        </p>
        <p className="text-sm text-[var(--text-secondary)]">Usa la conexión Prisma del servicio y consulta solo metadatos. No muestra credenciales, datos de usuarios ni recibos individuales.</p>
        <p className="text-sm text-[var(--text-secondary)]">
          {ready === null
            ? 'Ejecuta la comprobación para conocer el estado de la conexión actual.'
            : ready
              ? 'Contrasta el SHA y la identidad del proyecto con el despliegue esperado.'
              : 'No actives el piloto. Revisa la conexión, el catálogo y los permisos con el responsable de PostgreSQL; no repitas creaciones inciertas.'}
        </p>
        <form action="/admin/roleplays/creation-readiness" method="get">
          <input type="hidden" name="check" value="1" />
          <button type="submit" className="min-h-11 w-full rounded-xl theme-action-primary px-4 py-2 font-semibold sm:w-auto">{requested ? 'Volver a comprobar' : 'Comprobar disponibilidad'}</button>
        </form>
      </section>
      {evidence !== null && (
        <section aria-label="Evidencia de comprobación" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
          <h2 className="font-semibold text-[var(--foreground)]">Evidencia de comprobación</h2>
          <p className="text-sm text-[var(--text-secondary)]">Copia este resumen para registrar el resultado. Refleja la comprobación realizada, no el estado futuro ni la identidad verificada del proyecto.</p>
          <CopyDiagnostic key={evidence} evidence={evidence} />
        </section>
      )}
      <section aria-label="Configuración de subida directa" className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
        <h2 className="font-semibold text-[var(--foreground)]">Subida directa de audios</h2>
        <p className="text-sm font-medium text-[var(--foreground)]">{direct.formConfigured ? 'Banderas de subida directa configuradas' : 'Subida directa no configurada por completo'}</p>
        <p className="text-sm text-[var(--text-secondary)]">Esta comprobación solo describe las banderas y la presencia de variables del servicio. No verifica las credenciales, el catálogo de reservas, las políticas de Storage ni la configuración incluida en el navegador al compilar.</p>
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--text-secondary)]">Banderas configuradas</dt><dd className="font-medium text-[var(--foreground)]">{direct.flags.filter(item => item.configured).length} de {direct.flags.length}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--text-secondary)]">Variables presentes</dt><dd className="font-medium text-[var(--foreground)]">{direct.requirements.filter(item => item.present).length} de {direct.requirements.length}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--text-secondary)]">Consulta de reservas guardadas</dt><dd className="font-medium text-[var(--foreground)]">{direct.reservationLookupConfigured ? 'Configurada' : 'Desactivada'}</dd></div>
        </dl>
        <details className="space-y-2">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--theme-link)]">Ver requisitos de configuración</summary>
          <dl className="space-y-2 text-xs">
            {direct.flags.map(item => <div key={item.name} className="flex flex-wrap justify-between gap-1"><dt className="break-all text-[var(--text-secondary)]">{item.name}</dt><dd className="text-[var(--foreground)]">{item.configured ? 'Configurada' : 'Desactivada'}</dd></div>)}
            {direct.requirements.map(item => <div key={item.label} className="flex flex-wrap justify-between gap-1"><dt className="break-all text-[var(--text-secondary)]">{item.label}</dt><dd className="text-[var(--foreground)]">{item.present ? 'Presente' : 'Falta valor'}</dd></div>)}
          </dl>
        </details>
        <p className="text-sm text-[var(--text-secondary)]">Antes de activar: comprueba el catálogo y las restricciones de reservas, el presupuesto de objetos, los permisos privados, el flujo de recuperación y las pruebas aisladas de Storage. No actives banderas desde esta pantalla.</p>
      </section>
      <section aria-label="Catálogo y presupuesto de subida directa" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
        <h2 className="font-semibold text-[var(--foreground)]">Catálogo y presupuesto de subida directa</h2>
        <p className="text-sm text-[var(--text-secondary)]">Consulta explícita del catálogo y la contabilidad de reservas desde la conexión del servicio. No recorre los objetos de Storage ni modifica registros.</p>
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--text-secondary)]">Registro de reservas</dt><dd className="text-[var(--foreground)]">{directCatalog ? reservationLabels[directCatalog.reservation] : 'Sin comprobar'}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--text-secondary)]">Presupuesto persistente</dt><dd className="text-[var(--foreground)]">{directCatalog ? budgetLabels[directCatalog.budget] : 'Sin comprobar'}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--text-secondary)]">Permisos de registros internos</dt><dd className="text-[var(--foreground)]">{directCatalog ? permissionLabels[directCatalog.permissions.state] : 'Sin comprobar'}</dd></div>
          {directCatalog?.capacity && <>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--text-secondary)]">Cupos contables asignados</dt><dd className="text-[var(--foreground)]">{directCatalog.capacity.allocatedSlots} de {directCatalog.capacity.maxSlots}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-[var(--text-secondary)]">Cupos contables restantes</dt><dd className="text-[var(--foreground)]">{directCatalog.capacity.remainingSlots}</dd></div>
          </>}
        </dl>
        {directCatalog && directCatalog.permissions.tables.length > 0 && (
          <details className="space-y-2">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--theme-link)]">Ver permisos por registro interno</summary>
            <dl className="space-y-2 text-xs">
              {directCatalog.permissions.tables.map(table => (
                <div key={table.name} className="space-y-1">
                  <dt className="break-all font-medium text-[var(--foreground)]">{table.name}</dt>
                  <dd className="text-[var(--text-secondary)]">Acceso del servicio: {table.runtimeAccess ? 'Reconocido' : 'Requiere revisión'}. Aislamiento de roles públicos: {table.privateAccess ? 'Reconocido' : 'Requiere revisión'}.</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        {directCatalog && !directCatalog.capacity && <p role="status" className="text-sm text-[var(--theme-warning)]">No se informa capacidad contable utilizable; revisa la auditoría de reservas y presupuesto.</p>}
        <p className="text-sm text-[var(--text-secondary)]">Los cupos contables no representan espacio libre real ni autorizan subidas. Se comprueban los permisos esperados de cinco tablas internas, no todas las operaciones de publicación, los disparadores ni las políticas privadas de Storage.</p>
        <form action="/admin/roleplays/creation-readiness" method="get">
          <input type="hidden" name="checkDirect" value="1" />
          {requested && <input type="hidden" name="check" value="1" />}
          <button type="submit" className="min-h-11 w-full rounded-xl theme-action-primary px-4 py-2 font-semibold sm:w-auto">{directRequested ? 'Volver a comprobar catálogo y presupuesto' : 'Comprobar catálogo y presupuesto'}</button>
        </form>
      </section>
      <section aria-label="Estructura de publicación y almacenamiento" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
        <h2 className="font-semibold text-[var(--foreground)]">Estructura de publicación y almacenamiento</h2>
        <p className="text-sm text-[var(--text-secondary)]">Revisa los metadatos de las tablas de publicación y apertura, los disparadores esperados y la configuración de los buckets privados. No lee objetos ni genera enlaces firmados.</p>
        <p role="status" className="text-sm font-medium text-[var(--foreground)]">{rollout ? rollout.schemaMetadataReady ? 'Estructura de publicación y apertura reconocida' : 'Estructura de publicación y apertura requiere revisión' : rolloutRequested ? 'Metadatos no disponibles desde esta conexión' : 'Metadatos sin comprobar'}</p>
        {rollout && <>
          <dl className="space-y-2 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><dt>Tablas reconocidas</dt><dd>{rollout.tableChecks.filter(t => t.state === 'present-private').length} de {rollout.tableChecks.length}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt>Disparadores reconocidos</dt><dd>{rollout.triggerChecks.filter(t => t.enabled).length} de {rollout.triggerChecks.length}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt>Columnas reconocidas</dt><dd>{Object.values(rollout.columnChecks).filter(Boolean).length} de {Object.keys(rollout.columnChecks).length}</dd></div>
            {rollout.buckets.map(bucket => <div key={bucket.id} className="space-y-1"><dt className="break-all font-medium">{bucket.id}</dt><dd>{metadataLabels[bucket.state]}</dd><dd className="text-xs text-[var(--text-secondary)]">Requisito: privado, 15 MiB por archivo; {bucket.id === 'roleplay-audio-private' ? 'MP3, WAV, WebM y MP4' : 'WebM, MP4, OGG y MP3'} de audio.</dd></div>)}
          </dl>
          <details className="space-y-2 text-sm">
            <summary className="cursor-pointer font-semibold text-[var(--theme-link)]">Ver comprobaciones de estructura</summary>
            <dl className="space-y-2 text-xs">
              {rollout.tableChecks.map(t => <div key={t.name}><dt className="break-all">{t.name}</dt><dd>{metadataLabels[t.state]}</dd></div>)}
              {rollout.triggerChecks.map(t => <div key={t.name}><dt className="break-all">{t.name}</dt><dd>{t.enabled ? 'Reconocido' : 'Requiere revisión'}</dd></div>)}
              {Object.entries(rollout.columnChecks).map(([name, present]) => <div key={name}><dt>{({ opening: 'Apertura requerida', capability: 'Estado de capacidad', releaseGate: 'Control de liberación', assignmentHash: 'Huella de asignación' } as Record<string, string>)[name]}</dt><dd>{present ? 'Reconocida' : 'Requiere revisión'}</dd></div>)}
            </dl>
          </details>
        </>}
        <p className="text-sm text-[var(--text-secondary)]">Estos resultados no comprueban las políticas efectivas de Storage, el contenido de los objetos, los permisos de la API ni el funcionamiento real de los disparadores. No autorizan activar el piloto.</p>
        <form action="/admin/roleplays/creation-readiness" method="get">
          <input type="hidden" name="checkRollout" value="1" />
          <button type="submit" className="min-h-11 w-full rounded-xl theme-action-primary px-4 py-2 font-semibold sm:w-auto">{rolloutRequested ? 'Volver a comprobar estructura y buckets' : 'Comprobar estructura y buckets'}</button>
        </form>
      </section>
      {direct.reservationLookupConfigured && <SavedReservationLookup />}
      <p className="text-sm text-[var(--text-secondary)]">Un resultado favorable no autoriza activar el piloto. Aún se debe verificar el proyecto, el SHA esperado, las restricciones y el procedimiento de recuperación. Esta pantalla no aplica migraciones ni modifica banderas.</p>
    </main>
  );
}
