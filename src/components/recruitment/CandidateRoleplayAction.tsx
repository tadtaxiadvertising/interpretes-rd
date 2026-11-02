'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startCandidateRoleplay } from '@/app/actions/roleplay';

export function CandidateRoleplayAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setPending(true);
    setError(null);
    try {
      const result = await startCandidateRoleplay();
      if (!result.success || !result.data?.sessionId) {
        throw new Error(result.error || 'No se pudo iniciar el Roleplay.');
      }
      router.push(`/roleplays/${result.data.sessionId}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar el Roleplay.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleStart}
        disabled={pending}
        className="inline-flex items-center justify-center rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Preparando tu Roleplay…' : 'Comenzar Roleplay'}
      </button>
      {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
