'use client';

import { useRef, useState } from 'react';
import { enableCandidateEmailBinding, requestCandidateMailboxProof, confirmCandidateMailboxProof } from '@/app/actions/candidate-email-binding';

const messages = {
  linked: 'Tu cuenta quedó vinculada. Verifica ahora tu buzón para recibir comunicaciones.',
  already_linked: 'Tu cuenta ya está vinculada. Si no has verificado el buzón, solicita el código.',
  not_eligible: 'No se pudo verificar la vinculación desde este dispositivo. Puedes continuar tu postulación normalmente.',
  conflict: 'La vinculación requiere revisión administrativa. Puedes continuar tu postulación normalmente.',
  unavailable: 'La vinculación no está disponible en este momento. Tu acceso no cambia.',
  disabled: 'Esta función todavía no está habilitada.',
} as const;

export default function CandidateEmailBinding() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  async function verifyMailbox(confirm: boolean) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      if (confirm) {
        const result = await confirmCandidateMailboxProof(code.trim().toLowerCase());
        setMessage(result === 'verified' ? 'Correo verificado. Ya puedes recibir las comunicaciones del proceso.' : result === 'invalid' ? 'Código inválido, vencido o utilizado.' : 'No se pudo comprobar el código. Intenta más tarde.');
        if (result === 'verified') setCode('');
      } else {
        const result = await requestCandidateMailboxProof();
        setMessage(result === 'sent' ? 'Código aceptado por el servidor de correo. Revisa tu buzón y spam.' : result === 'unconfirmed' ? 'No pudimos confirmar el envío. Revisa tu buzón antes de solicitar otro código.' : 'No hay un código disponible ahora. Comprueba tu vinculación o inténtalo más tarde.');
      }
    } catch { setMessage(messages.unavailable); }
    finally { busy.current = false; setPending(false); }
  }
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
      <p className="text-sm text-[var(--text-secondary)]">Vincula tu cuenta verificada para futuras actualizaciones del proceso. La vinculación no cambia tu contraseña ni tu acceso. Para verificar el buzón, solicita un código de un solo uso.</p>
      <button type="button" onClick={link} disabled={pending} className="rounded-xl bg-[#1764bf] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1554a8] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">
        {pending ? 'Verificando…' : 'Vincular mi cuenta'}
      </button>
      <button type="button" disabled={pending} onClick={() => verifyMailbox(false)} className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--foreground)] disabled:opacity-60">Solicitar código por correo</button>
      <label className="block text-sm font-medium" htmlFor="mailbox-proof-code">Código de verificación</label>
      <input id="mailbox-proof-code" value={code} onChange={event => setCode(event.target.value)} maxLength={32} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} className="w-full rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3 text-[var(--foreground)]" />
      <button type="button" disabled={pending || !/^[0-9a-f]{32}$/i.test(code.trim())} onClick={() => verifyMailbox(true)} className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--foreground)] disabled:opacity-60">Confirmar correo</button>
      <p role="status" className="text-sm text-[var(--foreground)]">{message}</p>
    </section>
  );
}
