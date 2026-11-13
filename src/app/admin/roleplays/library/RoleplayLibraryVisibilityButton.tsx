'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Archive, RotateCcw, Loader2 } from 'lucide-react';

export function RoleplayLibraryVisibilityButton({
  fingerprint,
  sourceSessionId,
  archived,
}: {
  fingerprint: string;
  sourceSessionId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    const confirmed = window.confirm(
      archived
        ? '¿Restaurar este roleplay en la biblioteca administrativa?'
        : '¿Retirar este roleplay de la biblioteca? Dejará de estar disponible para nuevas asignaciones. Las sesiones, respuestas, evaluaciones y audios existentes se conservarán.'
    );
    if (!confirmed) return;
    setMessage(null);
    setWorking(true);
    try {
      const response = await fetch(`/api/admin/roleplays/library/${encodeURIComponent(fingerprint)}`, {
        method: archived ? 'DELETE' : 'POST',
        headers: archived ? undefined : { 'Content-Type': 'application/json' },
        body: archived ? undefined : JSON.stringify({ sourceSessionId }),
      });
      const result: { success?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'No se pudo completar la operación');
      }
      router.refresh();
      // Keep the button disabled until refreshed server props reflect the change.
      setMessage(archived ? 'Plantilla restaurada. Actualizando lista…' : 'Plantilla retirada. Actualizando lista…');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Error inesperado');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" disabled={working} onClick={submit}
        className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50">
        {working ? <Loader2 size={16} className="animate-spin" /> : archived ? <RotateCcw size={16} /> : <Archive size={16} />}
        {working ? 'Procesando…' : archived ? 'Restaurar' : 'Borrar de la biblioteca'}
      </button>
      {message && <p role="status" className="max-w-xs text-xs text-amber-100">{message}</p>}
    </div>
  );
}
