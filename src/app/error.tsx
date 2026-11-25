'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Avoid logging raw database errors or credentials to the browser console.
    console.error('[APP] Server rendering error digest:', error.digest ?? 'unavailable');
  }, [error.digest]);

  return (
    <main className="theme-workspace mx-auto flex min-h-[65dvh] max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center text-[var(--foreground)]">
      <h1 className="text-3xl font-bold">No se pudo cargar esta página</h1>
      <p className="text-[var(--text-secondary)]">Ocurrió un error temporal del servidor. Puedes intentar de nuevo o volver al inicio.</p>
      {error.digest && <p className="max-w-full break-all rounded-lg bg-[var(--theme-surface-muted)] px-4 py-2 font-mono text-xs text-[var(--text-secondary)]">Referencia del error: {error.digest}</p>}
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="theme-action-primary rounded-xl px-5 py-3 font-semibold">Reintentar</button>
        <Link href="/" className="theme-action-secondary rounded-xl px-5 py-3 font-semibold">Volver al inicio</Link>
      </div>
    </main>
  );
}
