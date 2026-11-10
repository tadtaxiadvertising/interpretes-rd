'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RequeueButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setState('loading');
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/roleplay-audio-jobs/${jobId}/requeue`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setState('error');
        setMessage(json.error || 'Error al reencolar');
        return;
      }
      setState('done');
      setMessage('Reencolado');
      router.refresh();
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Error de red');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={state === 'loading' || state === 'done'}
        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {state === 'loading' ? 'Reencolando...' : state === 'done' ? 'Reencolado' : 'Reencolar'}
      </button>
      {message && (
        <span className={`text-xs ${state === 'error' ? 'text-red-400' : 'text-green-400'}`}>
          {message}
        </span>
      )}
    </div>
  );
}
