'use client';

import { useRef, useState } from 'react';
import { requestCandidateMailboxProof, confirmCandidateMailboxProof } from '@/app/actions/candidate-email-binding';

export default function CandidateEmailBinding() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(false);
  const [showCode, setShowCode] = useState(false);

  async function verifyMailbox(confirm: boolean) {
    if (busy.current || verified) return;
    busy.current = true;
    setPending(true);
    try {
      if (confirm) {
        const result = await confirmCandidateMailboxProof(code.trim().toLowerCase());
        setMessage(result === 'verified' ? 'Correo verificado. Ya puedes recibir las comunicaciones del proceso.' : result === 'invalid' ? 'Código inválido, vencido o utilizado. Comprueba el código e inténtalo nuevamente.' : 'No se pudo comprobar el código. Intenta más tarde.');
        if (result === 'verified') {
          setCode('');
          setVerified(true);
        }
      } else {
        const result = await requestCandidateMailboxProof();
        setShowCode(true);
        setMessage(result === 'sent' ? 'Revisa tu buzón y la carpeta de spam. Copia el código recibido; vence en 15 minutos.' : result === 'unconfirmed' ? 'No pudimos confirmar el envío. Revisa tu buzón antes de solicitar otro código.' : 'No hay un código nuevo disponible. Si ya recibiste uno, puedes confirmarlo; si no, intenta más tarde.');
      }
    } catch { setMessage('La verificación no está disponible ahora. Tu acceso a la postulación no cambia.'); }
    finally { busy.current = false; setPending(false); }
  }
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-5">
      <h2 className="font-semibold">Comunicaciones de tu postulación</h2>
      <p className="text-sm text-[var(--text-secondary)]">Verifica tu correo para recibir actualizaciones. Este paso es opcional y no modifica tu acceso ni tu contraseña.</p>
      {!verified && (
        <>
          <button type="button" disabled={pending} onClick={() => verifyMailbox(false)} className="rounded-xl bg-[#1764bf] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1554a8] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">{pending ? 'Procesando…' : showCode ? 'Solicitar otro código' : 'Verificar mi correo'}</button>
          {!showCode && <button type="button" disabled={pending} onClick={() => setShowCode(true)} className="block text-sm font-medium text-[var(--theme-link)] underline">Ya tengo un código</button>}
          {showCode && (
            <>
              <label className="block text-sm font-medium" htmlFor="mailbox-proof-code">Código de verificación</label>
              <input id="mailbox-proof-code" value={code} onChange={event => setCode(event.target.value)} maxLength={32} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} className="w-full rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3 text-[var(--foreground)]" />
              <button type="button" disabled={pending || !/^[0-9a-f]{32}$/i.test(code.trim())} onClick={() => verifyMailbox(true)} className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--foreground)] disabled:opacity-60">Confirmar correo</button>
            </>
          )}
        </>
      )}
      <p role="status" className="text-sm text-[var(--foreground)]">{message}</p>
    </section>
  );
}
