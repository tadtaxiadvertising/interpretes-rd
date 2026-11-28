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
}: { result: DirectReservationObservationResult | 'CHECKING' }) {
  if (result === 'CHECKING') return <p role="status" className="text-sm text-[var(--foreground)]">{directReservationObservationLabels.CHECKING}</p>;
  const { status, progress } = result;
  const seconds = progress ? Math.max(0, Math.ceil((Date.parse(progress.expiresAt) - Date.parse(progress.observedAt)) / 1000)) : 0;
  return (
    <div className="space-y-2" role="status">
      <p className="text-sm text-[var(--foreground)]">{directReservationObservationLabels[status]}</p>
      {status === 'PUBLICATION_CONFIRMED' && result.sessionId && (
        <Link href={`/admin/roleplays/${encodeURIComponent(result.sessionId)}`} prefetch={false} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-xl theme-action-primary px-4 py-2 text-sm font-semibold">Ver roleplay confirmado (nueva pestaña)</Link>
      )}
      {progress && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <label className="block text-sm text-[var(--foreground)]">
            Verificación registrada: {progress.recordedVerifiedCount} de {progress.total} audios
            <progress className="mt-1 block w-full" max={progress.total} value={progress.recordedVerifiedCount}/>
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
