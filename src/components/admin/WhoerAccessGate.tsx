'use client';

import { useState } from 'react';

export default function WhoerAccessGate({ url, expectedCountry }: { url: string; expectedCountry?: string | null }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="min-w-48 space-y-2">
      <a href="https://whoer.net/" target="_blank" rel="noopener noreferrer" className="inline-flex text-blue-300 hover:underline">
        1. Comprobar conexión en Whoer.net ↗
      </a>
      <label className="flex items-start gap-2 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          Confirmo que revisé el país de salida{expectedCountry ? ` (esperado: ${expectedCountry})` : ''} y que la conexión es correcta.
        </span>
      </label>
      {confirmed ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">
          2. Abrir portal ↗
        </a>
      ) : (
        <p className="text-xs text-amber-300">El acceso al portal queda oculto hasta confirmar la revisión manual.</p>
      )}
      <p className="text-[11px] text-slate-500">La aplicación no lee ni valida automáticamente el resultado de Whoer.</p>
    </div>
  );
}
