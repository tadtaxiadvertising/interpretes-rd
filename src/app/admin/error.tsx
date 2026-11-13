'use client';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center text-white">
      <h2 className="text-2xl font-bold">No se pudo cargar el administrador</h2>
      <p className="mt-3 text-sm text-gray-300">No se han modificado tus datos. Reintenta cuando el servicio esté disponible.</p>
      {error.digest && <p className="mt-3 font-mono text-xs text-gray-400">Referencia: {error.digest}</p>}
      <button type="button" onClick={reset} className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500">
        Reintentar
      </button>
    </div>
  );
}
