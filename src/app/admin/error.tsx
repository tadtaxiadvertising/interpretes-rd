'use client';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-red-500/20 bg-red-500/5 p-5 sm:p-8 text-center text-[var(--foreground)]">
      <h2 className="text-2xl font-bold text-[var(--theme-danger)]">No se pudo cargar el administrador</h2>
      <p className="mt-3 text-sm text-[var(--text-secondary)]">No se han modificado tus datos. Reintenta cuando el servicio esté disponible.</p>
      {error.digest && <p className="mt-3 font-mono text-xs break-all text-[var(--text-tertiary)]">Referencia: {error.digest}</p>}
      <button type="button" onClick={reset} className="mt-5 theme-action-primary rounded-xl px-5 py-3 font-semibold">
        Reintentar
      </button>
    </div>
  );
}
