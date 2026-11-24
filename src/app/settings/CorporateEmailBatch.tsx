'use client';

import { useRef, useState } from 'react';
import { processCorporateEmailBatch } from '@/app/actions/email-batch';
import type { EmailBatchResult } from '@/lib/email/recruitment-batch';

type Report = EmailBatchResult | { status: 'unauthorized' };

export default function CorporateEmailBatch({ enabled }: { enabled: boolean }) {
  const busy = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  async function run() {
    if (!enabled || !confirmed || busy.current) return;
    busy.current = true;
    setPending(true);
    setConfirmed(false);
    setReport(null);
    try {
      setReport(await processCorporateEmailBatch());
    } catch {
      setReport({ status: 'unavailable', selected: 0, accepted: 0, unconfirmed: 0, cancelled: 0, deferred: 0, reconciliationRequired: 0 });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <section className="space-y-3 border-t border-[var(--border)] pt-4 text-[var(--foreground)]" aria-labelledby="email-batch-title">
      <h3 id="email-batch-title" className="font-semibold">Procesar comunicaciones</h3>
      <p className="text-sm">Ejecución manual de hasta dos eventos recientes elegibles. Puede enviar correos reales a cuentas vinculadas y verificadas. No procesa eventos históricos ni reintenta envíos inciertos.</p>
      {!enabled && <p className="text-sm">Procesamiento desactivado o configuración incompleta.</p>}
      {enabled && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={pending} />
          Confirmo el procesamiento de comunicaciones reales.
        </label>
      )}
      <button type="button" onClick={run} disabled={!enabled || !confirmed || pending} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2">
        {pending ? 'Procesando…' : 'Procesar lote'}
      </button>
      <div role="status" aria-live="polite" className="space-y-1 text-sm">
        {report?.status === 'unauthorized' && <p>Se requiere una sesión administrativa.</p>}
        {report && report.status !== 'unauthorized' && (
          <>
            <p>{({ completed: 'Ejecución finalizada.', disabled: 'Procesamiento desactivado.', busy: 'Hay un procesamiento en curso o reciente en este servidor.', unavailable: 'No se pudo completar el procesamiento.' })[report.status]}</p>
            <p>Seleccionados: {report.selected} · Aceptados por SMTP: {report.accepted} · Sin confirmar: {report.unconfirmed} · Cancelados: {report.cancelled} · Diferidos: {report.deferred} · Requieren conciliación: {report.reconciliationRequired}</p>
          </>
        )}
      </div>
    </section>
  );
}
