'use client';

import { useState, useRef } from 'react';
import { testCorporateSmtp, checkCorporateBrevo } from '@/app/actions/operational-email';

const messages = {
  resend_auth: 'Resend rechazó la autenticación. Comprueba la clave API.',
  resend_forbidden: 'Resend denegó el acceso. Comprueba permisos y dominio autorizado.',
  resend_quota: 'Resend limitó la solicitud. Consulta la cuota y el panel del proveedor antes de enviar nuevamente.',
  resend_rejected: 'Resend rechazó la solicitud. Revisa el remitente y los registros del proveedor.',
  resend_unconfirmed: 'No se confirmó la aceptación de Resend. Revisa los registros y el buzón antes de repetir.',
  brevo_ready: 'Brevo respondió correctamente y el remitente configurado está activo. Esta consulta no confirma permisos de envío ni entrega.',
  brevo_sender_missing: 'Brevo respondió, pero no figura activo el remitente configurado. Revisa Remitentes en Brevo.',
  brevo_auth: 'Brevo rechazó la autenticación (HTTP 401). Revisa la clave API y las restricciones de acceso del proveedor.',
  brevo_forbidden: 'Brevo denegó el acceso (HTTP 403). Revisa permisos y restricciones de IP o de cuenta.',
  brevo_rejected: 'Brevo rechazó la solicitud. Comprueba la configuración del proveedor y los registros transaccionales.',
  brevo_rate_limited: 'Brevo limitó las solicitudes (HTTP 429). Consulta los límites antes de volver a intentar.',
  brevo_unavailable: 'Brevo respondió con un error del servidor. Si intentaste enviar, revisa el buzón antes de repetir.',
  brevo_network: 'No se obtuvo una respuesta válida de Brevo. Revisa la conexión HTTPS y el estado del proveedor; si intentaste enviar, comprueba el buzón antes de repetir.',
  brevo_response: 'Brevo respondió con un resultado inesperado. Revisa los registros del proveedor antes de repetir un envío.',
  brevo_not_selected: 'Selecciona Brevo API como proveedor.',
  accepted: 'El proveedor de correo aceptó el mensaje. Comprueba el buzón corporativo y la carpeta de spam; la entrega aún no está confirmada.',
  unconfirmed: 'No se pudo confirmar la aceptación. Revisa el proveedor y el buzón antes de repetir la prueba.',
  unauthorized: 'Se requiere una sesión administrativa.',
  disabled: 'Los correos operativos están desactivados.',
  incomplete: 'Faltan parámetros del proveedor.',
  invalid: 'La configuración del proveedor no es válida.',
  local_quota_reached: 'Presupuesto local agotado o sin registro válido. No se inició el envío.',
  local_quota_unavailable: 'No se pudo reservar el presupuesto local. No se inició el envío.',
  rate_limited: 'Ya hay una prueba en curso o reciente. Intenta más tarde.',
} as const;

export default function CorporateSmtpTest({ configured, brevo = false }: { configured: boolean; brevo?: boolean }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  async function run(probe: boolean) {
    if (!configured || busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await (probe ? checkCorporateBrevo() : testCorporateSmtp());
      setMessage(messages[result]);
    } catch {
      setMessage(messages.unconfirmed);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="space-y-2">
      <p className="text-sm">La prueba solo se dirige al remitente corporativo configurado. No envía mensajes a postulantes. Las pruebas de proveedores API o SMTP identificados reservan un intento del presupuesto local.</p>
      {brevo && (
        <button type="button" disabled={!configured || pending} onClick={() => run(true)} className="mr-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2">
          Comprobar conexión Brevo (sin enviar)
        </button>
      )}
      <button type="button" disabled={!configured || pending} onClick={() => run(false)} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2">
        {pending ? 'Comprobando…' : 'Enviar correo de prueba'}
      </button>
      <p role="status" aria-live="polite" className="text-sm">{message}</p>
    </div>
  );
}
