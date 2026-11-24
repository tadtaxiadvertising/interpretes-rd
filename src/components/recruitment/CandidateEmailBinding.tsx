'use client';

import { useRef, useState } from 'react';
import { enableCandidateEmailBinding } from '@/app/actions/candidate-email-binding';

const messages = {
  linked: 'Tu cuenta quedó vinculada para futuras comunicaciones del proceso.',
  already_linked: 'Tu cuenta ya está vinculada.',
  not_eligible: 'No se pudo verificar la vinculación desde este dispositivo. Puedes continuar tu postulación normalmente.',
  conflict: 'La vinculación requiere revisión administrativa. Puedes continuar tu postulación normalmente.',
  unavailable: 'La vinculación no está disponible en este momento. Tu acceso no cambia.',
  disabled: 'Esta función todavía no está habilitada.',
} as const;

export default function CandidateEmailBinding() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function link() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      setMessage(messages[await enableCandidateEmailBinding()]);
    } catch {
      setMessage(messages.unavailable);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-5">
      <h2 className="font-semibold">Comunicaciones de tu postulación</h2>
      <p className="text-sm text-[var(--text-secondary)]">Vincula tu cuenta verificada para futuras actualizaciones del proceso. Esta opción no cambia tu contraseña ni tu acceso y no envía correos de inmediato.</p>
      <button type="button" onClick={link} disabled={pending} className="rounded-xl bg-[#1764bf] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1554a8] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">
        {pending ? 'Verificando…' : 'Vincular mi cuenta'}
      </button>
      <p role="status" className="text-sm text-[var(--foreground)]">{message}</p>
    </section>
  );
}
