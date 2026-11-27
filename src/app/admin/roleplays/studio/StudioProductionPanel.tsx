'use client';

import Link from 'next/link';
import { productionStatus } from '@/lib/roleplay-studio/production-tracking';
import type { StudioPublicationPart } from '@/lib/roleplay-studio/publication-parts';

type Props = {
  parts: Pick<StudioPublicationPart<unknown>, 'key' | 'number' | 'first' | 'last'>[];
  activeProductionKeys: ReadonlyMap<string, string>;
  preparedPartKey: string | null;
  localOnly: boolean;
  disabled: boolean;
  onSelectPart: (key: string) => void;
  onConfirmNavigation: () => boolean;
};

/** Advisory progress only. The parent owns package identity and handoff. */
export default function StudioProductionPanel({
  parts, activeProductionKeys, preparedPartKey, localOnly, disabled, onSelectPart, onConfirmNavigation,
}: Props) {
  // A missing receipt is only pending for a known package identity. A prepared
  // package is still active even before its first transfer is recorded.
  const tracked = parts.flatMap(part => {
    const key = activeProductionKeys.get(part.key);
    return key ? [{ part, status: productionStatus(key), prepared: preparedPartKey === part.key }] : [];
  });
  const pending = tracked.filter(item => !item.status && !item.prepared);
  const uncertain = tracked.filter(item => item.status === 'unconfirmed');
  const created = tracked.filter(item => item.status === 'created');
  const transferred = tracked.filter(item => item.status === 'transferred' || item.status === 'verified');
  const next = preparedPartKey === null ? pending[0]?.part : undefined;
  return (
    <section aria-label="Seguimiento de producción" className="space-y-2 rounded-lg border border-[var(--border)] p-3">
      <h4 className="text-sm font-semibold text-[var(--foreground)]">Seguimiento de producción</h4>
      <p className="text-xs text-[var(--text-secondary)]">Registro orientativo. Una creación confirmada significa al menos una asignación, no que todos los destinatarios la hayan recibido. Con respaldo local activo se conservan los intentos y creaciones confirmadas; los archivos preparados no sobreviven a una recarga. Consulta las sesiones existentes antes de repetir.</p>
      <p role="status" aria-label="Resumen de producción" className="text-xs text-[var(--text-secondary)]">
        {tracked.length} de {parts.length} partes con seguimiento · {pending.length} pendientes · {created.length} con creación confirmada · {uncertain.length} sin confirmar.
      </p>
      {uncertain.length > 0 && <p className="text-xs font-semibold text-[var(--theme-warning)]">Consulta las sesiones existentes antes de repetir una parte con intento sin confirmar.</p>}
      {transferred.length > 0 && <p className="text-xs text-[var(--text-secondary)]">Las partes transferidas o verificadas todavía no tienen creación confirmada.</p>}
      {preparedPartKey !== null && localOnly && parts.length > 1 && <p className="text-xs text-[var(--text-secondary)]">Hay un paquete preparado. Continúa a asignación antes de elegir otra parte; cambiar de parte puede descartar el paquete temporal.</p>}
      <ul className="max-h-64 space-y-1 overflow-y-auto text-xs sm:max-h-40">
        {tracked.map(({ part, status, prepared }) => {
          const label = status === 'created' ? 'Creación confirmada' : status === 'unconfirmed' ? 'Intento sin confirmar' :
            prepared ? 'Preparado' : status === 'verified' ? 'Importado y verificado' : status === 'transferred' ? 'Transferido' : 'Pendiente';
          return <li key={part.key} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] p-2">
            <span>Parte {part.number} · {part.first}–{part.last}</span>
            <span className={status === 'created' ? 'text-[var(--theme-success)]' : status === 'unconfirmed' ? 'text-[var(--theme-warning)]' : 'text-[var(--text-secondary)]'}>{label}</span>
            {localOnly && parts.length > 1 && <button type="button" disabled={disabled}
              className="theme-action-secondary min-h-11 rounded px-2 py-1 disabled:opacity-50 sm:min-h-0" onClick={() => onSelectPart(part.key)}>Seleccionar parte {part.number}</button>}
          </li>;
        })}
      </ul>
      {localOnly && parts.length > 1 && next && <button type="button" disabled={disabled}
        onClick={() => onSelectPart(next.key)}
        className="theme-action-secondary min-h-11 w-full rounded px-3 py-2 text-xs font-semibold disabled:opacity-50 sm:min-h-0 sm:w-auto">Elegir siguiente parte pendiente ({next.number})</button>}
      <Link href="/admin/roleplays" onClick={event => { if (!onConfirmNavigation()) event.preventDefault(); }} className="text-xs font-semibold text-[var(--theme-link)] underline">Consultar sesiones existentes</Link>
    </section>

  );
}
