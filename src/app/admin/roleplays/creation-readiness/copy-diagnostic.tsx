'use client';

import { useState } from 'react';

type CopyState = 'idle' | 'copying' | 'copied' | 'error';

export default function CopyDiagnostic({ evidence }: { evidence: string }) {
  const [state, setState] = useState<CopyState>('idle');

  async function copy() {
    setState('copying');
    try {
      await navigator.clipboard.writeText(evidence);
      setState('copied');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={state === 'copying'}
        onClick={copy}
        className="min-h-11 w-full rounded-xl theme-action-primary px-4 py-2 font-semibold disabled:opacity-60 sm:w-auto"
      >
        {state === 'copying' ? 'Copiando…' : 'Copiar diagnóstico'}
      </button>
      <p role="status" className="text-sm text-[var(--text-secondary)]">
        {state === 'copied' ? 'Diagnóstico copiado.' : state === 'error' ? 'No se pudo copiar automáticamente. Selecciona y copia el resumen manualmente.' : ''}
      </p>
      <pre className="select-all whitespace-pre-wrap break-words rounded-xl border border-[var(--border)] p-3 font-mono text-xs text-[var(--foreground)]">{evidence}</pre>
    </div>
  );
}
