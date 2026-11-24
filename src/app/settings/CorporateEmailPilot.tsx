'use client';
import { useRef, useState } from 'react';
import { runCorporateEmailPilot } from '@/app/actions/email-pilot';
import { checkCorporateEmailPilot } from '@/app/actions/email-pilot-preflight';

const preparation = {
  disabled: 'El piloto no está habilitado de forma exclusiva.',
  configuration_pending: 'Faltan controles de configuración. Revisa la sección de automatización.',
  database_pending: 'Comprueba la instalación y los permisos de la base de datos de comunicaciones.',
  candidate_missing: 'No existe una candidatura con el correo de prueba configurado.',
  binding_missing: 'Inicia sesión como postulante de prueba y solicita la verificación del correo.',
  mailbox_pending: 'El código de verificación está pendiente. Confírmalo en el portal de postulante.',
  mailbox_unverified: 'Verifica el buzón desde el portal de postulante de prueba.',
  review_required: 'Hay registros ambiguos o inconsistentes. Revisa el historial antes de continuar.',
  no_event: 'No hay un evento elegible pendiente de las últimas 24 horas y posterior a la fecha de inicio. Puede que ya se haya procesado.',
  identity_unverified: 'La cuenta o el evento cambió o no supera la comprobación de identidad.',
  ready: 'Hay un evento elegible. Puedes ejecutar el piloto y confirmar la recepción en el buzón.',
  unavailable: 'No se pudo completar el diagnóstico. No se ha enviado ningún correo.',
  unauthorized: 'Se requiere acceso administrativo.',
} as const;

export default function CorporateEmailPilot({ configured }: { configured: boolean }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState('');
  const [diagnostic, setDiagnostic] = useState('');
  const [ready, setReady] = useState(false);

  async function check() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setReady(false);
    setResult('');
    try {
      const report = await checkCorporateEmailPilot();
      setDiagnostic(preparation[report.status]);
      setReady(report.status === 'ready');
    } catch { setDiagnostic(preparation.unavailable); }
    finally { busy.current = false; setPending(false); }
  }

  async function run() {
    if (!configured || !ready || busy.current) return;
    setReady(false);
    busy.current = true;
    setPending(true);
    try {
      const report = await runCorporateEmailPilot();
      if (report.status === 'unauthorized') setResult('Se requiere acceso administrativo.');
      else if (report.status === 'completed') setResult(report.accepted > 0
        ? 'SMTP aceptó ' + report.accepted + ' correo. Confirma su recepción en el buzón de prueba.'
        : report.examined === 0 ? 'No se encontró un evento elegible; no se envió ningún correo. Comprueba la preparación nuevamente.'
          : 'No se confirmó la aceptación de ningún correo. Revisa el historial y la preparación antes de repetir.');
      else if (report.status === 'review_required' || report.status === 'unavailable') setResult('Requiere revisión. No repitas el envío sin comprobar el historial y el buzón.');
      else if (report.status === 'busy') setResult('Ya hay una ejecución en curso o reciente.');
      else setResult('Piloto desactivado. Revisa los controles de configuración.');
    } catch { setResult('No se pudo confirmar el resultado. Revisa el historial antes de repetir.'); }
    finally { busy.current = false; setPending(false); }
  }
  return (
    <section className="space-y-2 rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--foreground)]">
      <h3 className="font-semibold">Prueba piloto de reclutamiento</h3>
      <p>Procesa como máximo un evento real de la cuenta de prueba autorizada en el servidor. No permite introducir destinatarios ni ejecutar el piloto con el programador habilitado.</p>
      <button type="button" disabled={pending} onClick={check} className="rounded-xl border border-[var(--border)] px-4 py-2 font-semibold text-[var(--theme-link)] disabled:opacity-50">{pending ? 'Procesando…' : 'Comprobar preparación del piloto'}</button>
      <p role="status" aria-live="polite">{diagnostic || 'Comprueba la preparación antes de enviar.'}</p>
      <button type="button" disabled={!configured || !ready || pending} onClick={run} className="rounded-xl border border-[var(--border)] px-4 py-2 font-semibold text-[var(--theme-link)] disabled:opacity-50">{pending ? 'Procesando…' : 'Ejecutar piloto controlado'}</button>
      <p role="status">{result || (configured ? 'Comprueba la preparación para habilitar la ejecución controlada.' : 'Configura una cuenta de prueba y los controles de despacho; mantén desactivado el programador.')}</p>
    </section>
  );
}
