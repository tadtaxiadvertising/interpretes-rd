'use client';

import { useRef, useState } from 'react';
import { readNotificationEmailBudget } from '@/app/actions/notification-email-budget';
import { providerCatalog } from '@/lib/email/provider-catalog';

type Report = Awaited<ReturnType<typeof readNotificationEmailBudget>>;
const availabilityText = { available: 'Disponible', low: 'Presupuesto bajo', exhausted: 'Agotado', invalid_period: 'Período inconsistente' } as const;

const storageText = {
  ready: 'Registro instalado y permisos del servidor comprobados.',
  not_installed: 'Falta la instalación del registro presupuestario. Los envíos API protegidos no pueden reservar intentos.',
  permission_mismatch: 'Revisa los permisos y el aislamiento del registro con el administrador de la base de datos. No concedas acceso a los roles públicos de la API.',
  unavailable: 'No se pudo comprobar el registro presupuestario.',
} as const;

export default function NotificationEmailBudget() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  async function check() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setReport(null);
    try { setReport(await readNotificationEmailBudget()); }
    catch { setReport({ status: 'unavailable' }); }
    finally { pending.current = false; setBusy(false); }
  }

  return (
    <section aria-labelledby="notification-email-budget" className="glass rounded-3xl border border-[var(--border)] p-6 space-y-4 text-[var(--foreground)]">
      <h2 id="notification-email-budget" className="font-semibold">Presupuesto de correo operativo</h2>
      <p className="text-sm text-[var(--text-secondary)]">Consulta los intentos disponibles según el presupuesto local. No activa el despacho ni comprueba las credenciales del proveedor.</p>
      <button type="button" disabled={busy} onClick={check} className="min-h-11 rounded-xl border border-[var(--theme-control-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--theme-hover)] disabled:opacity-60">
        {busy ? 'Consultando…' : 'Consultar presupuesto local'}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {busy ? 'Consultando los contadores persistentes…' : !report ? 'Sin comprobar.' :
          report.status === 'ready' ? 'Consulta completada.' :
          report.status === 'unauthorized' ? 'Se requiere una sesión administrativa.' :
          report.status === 'rate_limited' ? 'Demasiadas consultas. Inténtalo más adelante.' :
          'No se pudo consultar el presupuesto local. No se presupone saldo cero.'}
      </p>
      {report && 'source' in report && (
        <dl className="space-y-2 text-sm">
          <div><dt className="font-medium">Origen del transporte</dt><dd>{report.source === 'vault' ? 'Almacén de proveedores' : report.source === 'environment' ? 'Variables de entorno' : 'Configuración no válida'}</dd></div>
          <div><dt className="font-medium">Controles de correo</dt><dd>Correo {report.emailEnabled ? 'habilitado' : 'desactivado'} · despacho {report.dispatchEnabled ? 'habilitado' : 'desactivado'} · modo {report.mode === 'pilot' ? 'piloto' : report.mode === 'general' ? 'general' : 'desactivado'}</dd></div>
          <div><dt className="font-medium">Registro presupuestario</dt><dd>{storageText[report.storage]}</dd></div>
          {report.activeApiProvider && <div><dt className="font-medium">Proveedor API seleccionado en entorno</dt><dd>{providerCatalog[report.activeApiProvider].label} (selección configurada, no conexión verificada)</dd></div>}
          <div><dt className="font-medium">Cobertura de presupuesto</dt><dd>{report.source === 'vault' && report.vaultEnabled ? 'El despacho mediante el perfil del almacén reserva intentos locales; actualmente limitado al piloto.' : report.source === 'environment' ? 'El despacho de reclutamiento y las pruebas de Brevo y Resend por variables de entorno requieren reservar un intento local. SMTP genérico no está cubierto por estos contadores.' : 'El origen del transporte no está disponible o el almacén está desactivado. Estos saldos no confirman que se pueda enviar correo.'}</dd></div>
        </dl>
      )}
      {report?.status === 'ready' && (
        <>
          <p className="text-xs text-[var(--text-secondary)]">Consulta: {new Date(report.checkedAt).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })}. Los períodos de presupuesto se calculan en UTC.</p>
          <dl className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] px-3">
            {report.providers.map(({ provider, availability }) => (
              <div key={provider} className="py-3 text-sm space-y-1">
                <dt className="font-semibold">{providerCatalog[provider].label}{report.activeApiProvider === provider ? ' · seleccionado en entorno' : ''}</dt>
                <dd>{availability ? `${availabilityText[availability.status]} · quedan ${availability.remaining} intentos en el límite más restrictivo` : 'Presupuesto no comprobado o período inválido'}</dd>
                {availability && <dd className="text-[var(--text-secondary)]">Diario: {availability.dailyRemaining} · mensual: {availability.monthlyRemaining}</dd>}
              </div>
            ))}
          </dl>
          {report.activeApiProvider && report.providers.some(item => item.provider === report.activeApiProvider && (!item.availability || item.availability.status === 'exhausted' || item.availability.status === 'low')) && (
            <p className="text-sm text-[var(--foreground)]">El presupuesto del proveedor seleccionado requiere atención. Consulta los perfiles verificados y las alternativas en el centro de proveedores. Un saldo positivo por sí solo no permite cambiar de proveedor.</p>
          )}
        </>
      )}
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">El saldo local no confirma la cuota gratuita del proveedor, el plan contratado ni la entrega al buzón. No incluye envíos externos, históricos anteriores a la protección, SMTP genérico ni de autenticación. Los intentos inciertos no se reembolsan automáticamente.</p>
      <a href="#email-settings-heading" className="inline-block min-h-11 py-2 text-sm font-medium text-[var(--theme-link)] underline">Ir a configuración de proveedores de correo</a>
    </section>
  );
}
