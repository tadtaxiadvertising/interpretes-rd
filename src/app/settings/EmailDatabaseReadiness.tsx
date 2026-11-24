'use client';

import { useRef, useState } from 'react';
import { checkCorporateEmailDatabase } from '@/app/actions/email-database-readiness';

const messages = {
  not_installed: 'Falta instalar el registro privado de correos o la tabla de vinculaciones.',
  permission_mismatch: 'Las tablas existen, pero los permisos o las protecciones RLS requieren revisión.',
  ready: 'Tablas, permisos declarados y RLS detectados. Falta comprobar políticas efectivas y entrega real.',
  unavailable: 'No se pudo consultar la base de datos.',
  unauthorized: 'Se requiere una sesión administrativa.',
} as const;

export default function EmailDatabaseReadiness() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('Base de datos de correos aún no comprobada.');
  const busy = useRef(false);
  async function check() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      setMessage(messages[(await checkCorporateEmailDatabase()).status]);
    } catch {
      setMessage(messages.unavailable);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section aria-labelledby="email-db-readiness" className="space-y-2 rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--foreground)]">
      <h3 id="email-db-readiness" className="font-semibold">Base de datos de comunicaciones</h3>
      <p>Comprueba el esquema privado y los permisos de la conexión actual, sin leer expedientes ni modificar registros.</p>
      <button type="button" onClick={check} disabled={pending} className="rounded-xl border border-[var(--border)] px-4 py-2 font-semibold text-[var(--theme-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">{pending ? 'Comprobando…' : 'Comprobar base de datos'}</button>
      <p role="status" aria-live="polite">{pending ? 'Consultando metadatos…' : message}</p>
    </section>
  );
}
