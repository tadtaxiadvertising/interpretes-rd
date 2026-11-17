'use client';

import { useState } from 'react';
import { safeHttpsUrl } from '@/lib/platform-input-security';

type GateProps = { url: string; expectedCountry?: string | null };

function PortalConsent({ safeUrl, expectedCountry }: {
  safeUrl: string | null;
  expectedCountry?: string | null;
}) {
  // State belongs to a keyed child so A -> B -> A never restores an
  // earlier approval. A simple confirmedFor === consentKey check would.
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
          disabled={!safeUrl}
          onChange={event => setConfirmed(event.target.checked)}
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

export default function WhoerAccessGate({ url, expectedCountry }: GateProps) {
  // Existing/historical rows can contain unsafe URLs: never expose them as
  // hrefs, regardless of whether a checkbox was previously confirmed.
  const parsed = safeHttpsUrl.safeParse(url);
  const safeUrl = parsed.success && parsed.data ? parsed.data : null;
  const consentKey = JSON.stringify([safeUrl, expectedCountry ?? '']);
  // A changed key forces a fresh checkbox for every portal/country switch,
  // including when the user switches back to a previously approved pair.
  return <PortalConsent key={consentKey} safeUrl={safeUrl} expectedCountry={expectedCountry} />;
}
