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

  async function lookup() {
    if (pending.current) return;
    const key = parseDirectReservationReference(reference);
    setStatus(null);
    setError(!key);
    if (!key) return;
    pending.current = true;
    setStatus('CHECKING');
    try { setStatus(await observeDirectReservation(key)); }
    finally { pending.current = false; }
  }

  return (
    <section aria-labelledby="saved-reservation-title" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-5">
      <h2 id="saved-reservation-title" className="font-semibold text-[var(--foreground)]">Consultar una reserva guardada</h2>
      <p className="text-sm text-[var(--text-secondary)]">Usa la referencia UUID de una subida directa anterior con la misma cuenta administrativa. No se restauran los archivos, no se reenvían audios y no se autoriza una nueva creación.</p>
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); void lookup(); }}>
        <label htmlFor="saved-direct-reservation" className="block text-sm font-medium text-[var(--foreground)]">Referencia de la reserva directa guardada</label>
        <input id="saved-direct-reservation" value={reference}
          onChange={event => { setReference(event.target.value); setError(false); setStatus(null); }}
          maxLength={80} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          disabled={status === 'CHECKING'} aria-invalid={error}
          aria-describedby={error ? 'saved-reservation-error' : undefined}
          className="min-h-11 w-full rounded-xl border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-3 text-sm text-[var(--theme-control-text)]"/>
        {error && <p id="saved-reservation-error" role="alert" className="text-sm text-[var(--theme-danger)]">Introduce una referencia UUID válida de la reserva directa.</p>}
        <button type="submit" disabled={status === 'CHECKING'} className="min-h-11 w-full rounded-xl theme-action-primary px-4 py-2 font-semibold disabled:opacity-50 sm:w-auto">Consultar reserva guardada</button>
      </form>
      {status && <DirectReservationObservationSummary result={status}/>}
    </section>
  );
}
