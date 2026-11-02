'use client';

import { useState } from 'react';
import { updatePassword } from '@/app/actions/auth';

export function CandidatePasswordSetup() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const result = await updatePassword(formData);
      if (!result.success) {
        setError(result.error || 'No se pudo guardar la contraseña.');
      } else {
        setMessage('Tu contraseña quedó configurada. Podrás volver a entrar con tu correo y esta contraseña.');
      }
    } catch {
      setError('No se pudo guardar la contraseña. Inténtalo nuevamente.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div>
        <h3 className="font-semibold text-white">Configura tu contraseña</h3>
        <p className="mt-1 text-sm leading-5 text-slate-400">Hazlo ahora para poder volver a tu candidatura cuando cierres sesión.</p>
      </div>
      <input
        name="password"
        type="password"
        minLength={8}
        required
        autoComplete="new-password"
        placeholder="Nueva contraseña (mínimo 8 caracteres)"
        className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-400"
      />
      <input
        name="confirmPassword"
        type="password"
        minLength={8}
        required
        autoComplete="new-password"
        placeholder="Confirma tu contraseña"
        className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-400"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl border border-blue-300/20 bg-blue-400/10 px-4 py-2.5 text-sm font-semibold text-blue-100 hover:bg-blue-400/20 disabled:opacity-60"
      >
        {pending ? 'Guardando…' : 'Guardar contraseña'}
      </button>
      {message ? <p role="status" className="text-sm text-emerald-300">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    </form>
  );
}
