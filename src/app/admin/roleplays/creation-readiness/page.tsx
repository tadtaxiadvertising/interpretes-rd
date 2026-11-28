import Link from 'next/link';
import CopyDiagnostic from './copy-diagnostic';
import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
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
  searchParams: Promise<{ check?: string | string[] }>;
}) {
  const auth = await validateAction('admin');
  if ('error' in auth || auth.user.role !== 'admin') {
    return <p role="alert" className="text-[var(--theme-danger)]">Acceso restringido a administradores.</p>;
  }

  const pilot = readCreationPilotConfig(process.env);
  const sha = process.env.GIT_SHA?.trim() ?? '';
  const buildId = /^[a-f0-9]{40}$/i.test(sha) ? sha.toLowerCase() : null;
  // No catalog query on initial visit, link prefetch, or malformed request.
  // A refresh with check=1 repeats the bounded, read-only runtime check.
  const requested = (await searchParams).check === '1';
  const ready = requested ? await isCreationLedgerReady(prisma) : null;

  // Record when this check finished, not a build timestamp or an approval.
  // Only fixed labels and validated build metadata enter the evidence.
  const evidence = ready === null ? null : [
    'Diagnóstico de creación segura — Intérpretes RD',
    'Fecha de comprobación (UTC): ' + new Date().toISOString(),
    'SHA del servicio: ' + (buildId ?? 'No informado'),
    'Modo: ' + pilot.mode,
    'Registro de idempotencia: ' + (ready ? 'Disponible según comprobación' : 'No disponible según comprobación'),
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
      <p className="text-sm text-[var(--text-secondary)]">Un resultado favorable no autoriza activar el piloto. Aún se debe verificar el proyecto, el SHA esperado, las restricciones y el procedimiento de recuperación. Esta pantalla no aplica migraciones ni modifica banderas.</p>
    </main>
  );
}
