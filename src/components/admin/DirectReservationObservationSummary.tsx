import Link from 'next/link';
import {
  directReservationObservationLabels, type DirectReservationObservationResult,
} from '@/lib/roleplay/direct-reservation-status-browser';

function utc(value: string) {
  return value.slice(0, 19).replace('T', ' ') + ' UTC';
}

/** Snapshot of the server ledger, never live Storage or publication evidence. */
export default function DirectReservationObservationSummary({
  result,
}: { result: DirectReservationObservationResult | 'CHECKING' | null }) {
  const observation = result === 'CHECKING' ? null : result;
  const status = result === 'CHECKING' ? 'CHECKING' : observation?.status;
  const progress = observation?.progress;
  const seconds = progress ? Math.max(0, Math.ceil((Date.parse(progress.expiresAt) - Date.parse(progress.observedAt)) / 1000)) : 0;
  return (
    <div className="space-y-2">
      <p role="status" aria-atomic="true" className="text-sm text-[var(--foreground)]">{status ? directReservationObservationLabels[status] : ''}</p>
      {status === 'PUBLICATION_CONFIRMED' && observation?.sessionId && (
        <Link href={`/admin/roleplays/${encodeURIComponent(observation.sessionId)}`} prefetch={false} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl theme-action-primary px-4 py-2 text-center text-sm font-semibold sm:w-auto">Ver roleplay confirmado (nueva pestaña)</Link>
      )}
      {status === 'PUBLICATION_RECORDED' && (
        <Link href="/admin/roleplays" prefetch={false} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--theme-link)] underline">Consultar roleplays existentes (nueva pestaña)</Link>
      )}
      {progress && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <label className="block text-sm text-[var(--foreground)]">
            Verificación registrada: {progress.recordedVerifiedCount} de {progress.total} audios
            <progress className="mt-2 block h-3 w-full accent-[var(--theme-link)]" max={progress.total} value={progress.recordedVerifiedCount}/>
          </label>
          <dl className="space-y-1 text-sm">
            <div><dt className="text-[var(--text-secondary)]">Vencimiento registrado</dt><dd className="text-[var(--foreground)]"><time dateTime={progress.expiresAt}>{utc(progress.expiresAt)}</time></dd></div>
            <div><dt className="text-[var(--text-secondary)]">Fecha de consulta</dt><dd className="text-[var(--foreground)]"><time dateTime={progress.observedAt}>{utc(progress.observedAt)}</time></dd></div>
            <div><dt className="text-[var(--text-secondary)]">Tiempo restante al consultar</dt><dd className="font-medium text-[var(--foreground)]">{status === 'EXPIRED' ? 'Caducada al consultar' : Math.floor(seconds / 60) + ' min ' + seconds % 60 + ' s'}</dd></div>
          </dl>
          <p className="text-xs text-[var(--text-secondary)]">Resultado puntual del registro, no progreso en vivo. Vuelve a consultar para actualizarlo. No confirma que los archivos sigan disponibles ni que el roleplay esté publicado.</p>
        </div>
      )}
    </div>
  );
}
