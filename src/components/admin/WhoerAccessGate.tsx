'use client';

import { useState } from 'react';
import { safeHttpsUrl } from '@/lib/platform-input-security';

export default function WhoerAccessGate({ url, expectedCountry }: { url: string; expectedCountry?: string | null }) {
  // Historical records may predate server-side HTTPS validation. Never render
  // a navigable portal link for unsafe URLs, regardless of checkbox state.
  const parsed = safeHttpsUrl.safeParse(url);
  const safeUrl = parsed.success && parsed.data ? parsed.data : null;

  // Keep consent tied to this exact portal and expected exit country. Changing
  // either requires another review, even if React reuses the same component.
  const consentKey = safeUrl ? JSON.stringify([safeUrl, expectedCountry ?? '']) : null;
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const confirmed = consentKey !== null && confirmedFor === consentKey;

  return (
    <div className="min-w-48 space-y-2">
      <a href="https://whoer.net/" target="_blank" rel="noopener noreferrer" className="inline-flex text-blue-300 hover:underline">
        1. Comprobar conexión en Whoer.net ↗
      </a>
      <label className="flex items-start gap-2 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={!safeUrl}
          onChange={event => setConfirmedFor(event.target.checked ? consentKey : null)}
          className="mt-0.5"
        />
        <span>
          Confirmo que revisé el país de salida{expectedCountry ? ` (esperado: ${expectedCountry})` : ''} y que la conexión es correcta.
        </span>
      </label>
      {!safeUrl ? (
        <p role="alert" className="text-xs text-amber-300">
          El enlace guardado no cumple los requisitos HTTPS de seguridad. Corrige la dirección antes de abrir el portal.
        </p>
      ) : confirmed ? (
        <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">
          2. Abrir portal ↗
        </a>
      ) : (
        <p className="text-xs text-amber-300">El acceso al portal queda oculto hasta confirmar la revisión manual.</p>
      )}
      <p className="text-[11px] text-slate-500">La aplicación no lee ni valida automáticamente el resultado de Whoer.</p>
    </div>
  );
}
