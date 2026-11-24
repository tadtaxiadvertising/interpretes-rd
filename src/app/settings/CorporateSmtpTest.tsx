'use client';

import { useState, useRef } from 'react';
import { testCorporateSmtp } from '@/app/actions/operational-email';

const messages = {
  accepted: 'El proveedor de correo aceptó el mensaje. Comprueba el buzón corporativo y la carpeta de spam; la entrega aún no está confirmada.',
  unconfirmed: 'No se pudo confirmar la aceptación. Revisa el proveedor y el buzón antes de repetir la prueba.',
  unauthorized: 'Se requiere una sesión administrativa.',
  disabled: 'Los correos operativos están desactivados.',
  incomplete: 'Faltan parámetros del proveedor.',
  invalid: 'La configuración del proveedor no es válida.',
  rate_limited: 'Ya hay una prueba en curso o reciente. Intenta más tarde.',
} as const;

export default function CorporateSmtpTest({ configured }: { configured: boolean }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  async function send() {
    if (!configured || busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await testCorporateSmtp();
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
      <p className="text-sm">La prueba solo se dirige al remitente corporativo configurado. No envía mensajes a postulantes.</p>
      <button type="button" disabled={!configured || pending} onClick={send} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2">
        {pending ? 'Enviando prueba…' : 'Enviar correo de prueba'}
      </button>
      <p role="status" aria-live="polite" className="text-sm">{message}</p>
    </div>
  );
}
