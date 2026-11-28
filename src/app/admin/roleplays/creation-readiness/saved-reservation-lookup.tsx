'use client';

import { useRef, useState } from 'react';
import {
  observeDirectReservation, parseDirectReservationReference,
  type DirectReservationObservationResult,
} from '@/lib/roleplay/direct-reservation-status-browser';
import DirectReservationObservationSummary from '@/components/admin/DirectReservationObservationSummary';

export default function SavedReservationLookup() {
  const [reference, setReference] = useState('');
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<DirectReservationObservationResult | 'CHECKING' | null>(null);
  const pending = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function lookup() {
    if (pending.current) return;
    const key = parseDirectReservationReference(reference);
    setStatus(null);
    setError(!key);
    if (!key) {
      inputRef.current?.focus();
      return;
    }
    pending.current = true;
    setStatus('CHECKING');
    try { setStatus(await observeDirectReservation(key)); }
    finally { pending.current = false; }
  }

  return (
    <section aria-labelledby="saved-reservation-title" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
      <h2 id="saved-reservation-title" className="font-semibold text-[var(--foreground)]">Consultar una reserva guardada</h2>
      <p id="saved-reservation-help" className="text-sm text-[var(--text-secondary)]">Pega la referencia guardada y consulta con la misma cuenta administrativa. Solo se consulta el registro: no se restauran archivos ni se inicia otra creación.</p>
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); void lookup(); }}>
        <label htmlFor="saved-direct-reservation" className="block text-sm font-medium text-[var(--foreground)]">Referencia de la reserva directa guardada</label>
        <input ref={inputRef} id="saved-direct-reservation" value={reference}
          placeholder="UUID de la reserva" enterKeyHint="search"
          onChange={event => { setReference(event.target.value); setError(false); setStatus(null); }}
          maxLength={80} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          disabled={status === 'CHECKING'} aria-invalid={error}
          aria-describedby={error ? 'saved-reservation-help saved-reservation-error' : 'saved-reservation-help'}
          className={'min-h-11 w-full rounded-xl border bg-[var(--theme-control-bg)] px-3 text-base text-[var(--theme-control-text)] placeholder:text-[var(--text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-focus)] ' + (error ? 'border-[var(--theme-danger)]' : 'border-[var(--theme-control-border)]')}/>
        {error && <p id="saved-reservation-error" role="alert" className="text-sm text-[var(--theme-danger)]">Introduce una referencia UUID válida de la reserva directa.</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="submit" disabled={status === 'CHECKING'} className="min-h-11 w-full rounded-xl theme-action-primary px-4 py-2 font-semibold disabled:opacity-50 sm:w-auto">{status === 'CHECKING' ? 'Consultando reserva…' : 'Consultar reserva guardada'}</button>
          {reference && <button type="button" disabled={status === 'CHECKING'}
            onClick={() => { setReference(''); setError(false); setStatus(null); inputRef.current?.focus(); }}
            className="min-h-11 w-full rounded-xl theme-action-secondary px-4 py-2 text-sm font-semibold disabled:opacity-50 sm:w-auto">Limpiar referencia</button>}
        </div>
      </form>
      <DirectReservationObservationSummary result={status}/>
    </section>
  );
}
