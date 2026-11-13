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
    <main className="mx-auto flex min-h-[65vh] max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center text-slate-100">
      <h1 className="text-3xl font-bold">No se pudo cargar esta página</h1>
      <p className="text-slate-400">Ocurrió un error temporal del servidor. Puedes intentar de nuevo o volver al inicio.</p>
      {error.digest && <p className="rounded-lg bg-slate-800 px-4 py-2 font-mono text-xs text-slate-300">Referencia del error: {error.digest}</p>}
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500">Reintentar</button>
        <Link href="/" className="rounded-xl border border-slate-600 px-5 py-3 font-semibold hover:bg-slate-800">Volver al inicio</Link>
      </div>
    </main>
  );
}
