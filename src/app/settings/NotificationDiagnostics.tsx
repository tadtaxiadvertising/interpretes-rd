'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';

const METRICS = [
  ['messagesSampled', 'Mensajes revisados'],
  ['messagesWithoutDirectSender', 'Mensajes sin perfil directo del remitente'],
  ['messagesWithoutDirectReceiver', 'Mensajes sin perfil directo del destinatario'],
  ['noticesSampled', 'Notificaciones revisadas'],
  ['noticesUnread', 'Notificaciones sin leer'],
  ['noticesWithoutRecipient', 'Notificaciones sin destinatario'],
  ['noticesWithoutDirectProfile', 'Notificaciones sin perfil directo'],
  ['eligibleUnreadMessages', 'Mensajes recientes pendientes y elegibles'],
  ['missingMessageNotices', 'Avisos de mensajes faltantes'],
] as const;
type Metric = typeof METRICS[number][0];
type Report = Record<Metric, number> & {
  checkedAt: string; sampleLimit: number; messagesTruncated: boolean; noticesTruncated: boolean;
};

function parseReport(payload: unknown): Report | null {
  if (!payload || typeof payload !== 'object') return null;
  const response = payload as { success?: unknown; report?: unknown };
  if (response.success !== true || !response.report || typeof response.report !== 'object') return null;
  const value = response.report as Record<string, unknown>;
  if (typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) ||
      typeof value.messagesTruncated !== 'boolean' || typeof value.noticesTruncated !== 'boolean' ||
      typeof value.sampleLimit !== 'number' || !Number.isSafeInteger(value.sampleLimit) || value.sampleLimit <= 0) return null;
  for (const [key] of METRICS) {
    if (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) ||
        (value[key] as number) < 0 || (value[key] as number) > value.sampleLimit) return null;
  }
  return value as Report;
}

export default function NotificationDiagnostics() {
  const [report, setReport] = useState<Report | null>(null);
  const [status, setStatus] = useState('Sin comprobar.');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function check() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setReport(null);
    setStatus('Consultando registros recientes…');
    try {
      const response = await fetch('/api/admin/notification-diagnostics', {
        credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        setStatus('No autorizado. Inicia sesión como administrador.');
      } else if (response.status === 429) {
        setStatus('Demasiadas consultas. Inténtalo más adelante.');
      } else {
        const result = response.ok ? parseReport(payload) : null;
        setReport(result);
        setStatus(result ? 'Consulta completada. Resultados de la muestra, no de toda la base de datos.' : 'No se pudo obtener el diagnóstico.');
      }
    } catch {
      if (!controller.signal.aborted) setStatus('No se pudo obtener el diagnóstico.');
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section aria-labelledby="notification-diagnostics-heading" className="glass rounded-3xl border border-[var(--border)] p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Bell className="shrink-0 text-[var(--theme-link)]" aria-hidden="true" />
        <h2 id="notification-diagnostics-heading" className="text-lg font-semibold text-[var(--foreground)]">Diagnóstico de notificaciones</h2>
      </div>
      <p className="text-sm text-[var(--text-secondary)]">Consulta una muestra de los registros más recientes sin modificar datos ni leer conversaciones privadas.</p>
      <button type="button" onClick={check} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--theme-control-border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--theme-hover)] disabled:opacity-60">
        <RefreshCw size={16} aria-hidden="true" className={busy ? 'animate-spin' : ''} />
        {busy ? 'Comprobando…' : 'Comprobar notificaciones'}
      </button>
      <p role="status" aria-live="polite" className="text-sm text-[var(--foreground)]">{status}</p>
      {report && (
        <>
          <p className="text-xs text-[var(--text-secondary)]">Consulta: {new Date(report.checkedAt).toLocaleString('es-DO')}. Hasta {report.sampleLimit} registros de cada tipo.</p>
          {(report.messagesTruncated || report.noticesTruncated) && <p className="text-sm text-[var(--theme-warning)]">Hay más registros fuera de la muestra.</p>}
          <dl className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] px-3">
            {METRICS.map(([key, label]) => (
              <div key={key} className="flex items-start justify-between gap-3 py-2 text-sm">
                <dt className="text-[var(--text-secondary)]">{label}</dt>
                <dd className="font-semibold tabular-nums text-[var(--foreground)]">{report[key]}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">Los avisos faltantes se comprueban solo para mensajes sin leer de las últimas 24 horas con perfiles y permisos válidos. Un identificador sin perfil directo puede pertenecer a una cuenta antigua; no demuestra pérdida de datos. El resultado no verifica la entrega de correos ni el estado del trabajador de audio.</p>
        </>
      )}
    </section>
  );
}
