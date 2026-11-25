'use client';

import { useRef, useState } from 'react';
import { getCorporateEmailHistory } from '@/app/actions/email-history';
import type { EmailHistoryReport, EmailDeliveryStatus } from '@/lib/email/history-types';
import { providerCatalog } from '@/lib/email/provider-catalog';
import { recruitmentEmailTemplate } from '@/lib/email/recruitment-templates';

const labels: Record<EmailDeliveryStatus, string> = {
  pending: 'Pendiente',
  sending: 'En procesamiento',
  accepted: 'Aceptado por proveedor',
  unconfirmed: 'Sin confirmar',
  cancelled: 'Cancelado',
};

const dateFormatter = new Intl.DateTimeFormat('es-DO', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santo_Domingo',
});

export default function CorporateEmailHistory() {
  const [report, setReport] = useState<EmailHistoryReport | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function load() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setReport(null);
    try {
      setReport(await getCorporateEmailHistory());
    } catch {
      setReport({ status: 'unavailable' });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const message = pending ? 'Consultando historial…'
    : !report ? 'Historial aún no consultado.'
    : report.status === 'not_installed' ? 'El registro persistente todavía no está instalado.'
    : report.status === 'unavailable' ? 'No se pudo consultar el registro. Revisa la disponibilidad y los permisos del servidor.'
    : report.status === 'unauthorized' ? 'Se requiere una sesión administrativa.'
    : report.status === 'ready' && report.rows.length === 0 ? 'No hay comunicaciones visibles en el registro.'
    : 'Últimas comunicaciones registradas (máximo 30).';

  return (
    <section aria-labelledby="corporate-email-history" className="space-y-3 border-t border-[var(--border)] pt-4 text-[var(--foreground)]">
      <h3 id="corporate-email-history" className="font-semibold">Historial de comunicaciones</h3>
      <p className="text-sm">Registro operativo de solo lectura. No incluye correos de autenticación, códigos de verificación ni pruebas administrativas. El proveedor previsto se registra al reservar el envío; una cancelación puede no haber llegado al proveedor. Los registros antiguos o sin atribución muestran «Sin registro».</p>
      <button type="button" onClick={load} disabled={pending} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--theme-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">
        {pending ? 'Consultando…' : 'Consultar historial'}
      </button>
      <p role="status" aria-live="polite" className="text-sm">{message}</p>
      {report?.status === 'ready' && report.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Comunicaciones operativas recientes</caption>
            <thead><tr className="border-b border-[var(--border)]">
              <th scope="col" className="p-3">Comunicación</th>
              <th scope="col" className="p-3">Proveedor previsto</th>
              <th scope="col" className="p-3">Estado</th>
              <th scope="col" className="p-3">Registro</th>
              <th scope="col" className="p-3">Finalización</th>
            </tr></thead>
            <tbody>{report.rows.map((row, index) => (
              <tr key={index} className="border-b border-[var(--border)] last:border-0">
                <td className="p-3">{recruitmentEmailTemplate(row.kind).label}</td>
                <td className="p-3">{row.provider === null ? "Sin registro" : row.provider === "smtp" ? "SMTP (entorno)" : providerCatalog[row.provider].label}</td>
                <td className="p-3">{labels[row.status]}</td>
                <td className="p-3">{dateFormatter.format(new Date(row.createdAt))}</td>
                <td className="p-3">{row.completedAt ? dateFormatter.format(new Date(row.completedAt)) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs">Hora de República Dominicana. Aceptado por el proveedor no significa entregado al buzón. Los envíos sin confirmar o en procesamiento requieren revisión; esta pantalla no reintenta ni envía mensajes.</p>
    </section>
  );
}
