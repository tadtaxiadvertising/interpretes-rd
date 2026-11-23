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
    <form action={handleSubmit} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-5">
      <div>
        <h3 className="font-semibold text-[var(--foreground)]">Configurar o cambiar contraseña</h3>
        <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">Si accediste con un enlace, crea una contraseña para tus próximos ingresos. Si ya tienes una, puedes actualizarla aquí.</p>
      </div>
      <label htmlFor="candidate-new-password" className="block text-sm font-medium text-[var(--foreground)]">Nueva contraseña</label>
      <input
        id="candidate-new-password"
        name="password"
        type="password"
        minLength={8}
        required
        autoComplete="new-password"
        placeholder="Nueva contraseña (mínimo 8 caracteres)"
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] outline-none focus-visible:border-[#1764bf] focus-visible:ring-2 focus-visible:ring-[#1764bf]/25"
      />
      <label htmlFor="candidate-confirm-password" className="block text-sm font-medium text-[var(--foreground)]">Confirmar contraseña</label>
      <input
        id="candidate-confirm-password"
        name="confirmPassword"
        type="password"
        minLength={8}
        required
        autoComplete="new-password"
        placeholder="Confirma tu contraseña"
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] outline-none focus-visible:border-[#1764bf] focus-visible:ring-2 focus-visible:ring-[#1764bf]/25"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-[#1764bf] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1554a8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60"
      >
        {pending ? 'Guardando…' : 'Guardar contraseña'}
      </button>
      {message ? <p role="status" className="text-sm text-[var(--candidate-success-text)]">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-[var(--candidate-error-text)]">{error}</p> : null}
    </form>
  );
}
