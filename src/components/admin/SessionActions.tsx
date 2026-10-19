'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Mirrors the states that block a new session in POST /api/admin/roleplays.
// Cancelling is the explicit escape hatch that frees the participant for a
// new attempt (the only other path is rejecting the candidate).
const CANCELLABLE_STATUSES = [
  'DRAFT',
  'INVITED',
  'STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'EVALUATED',
  'PASSED',
  'FAILED',
];

export function SessionActions({ sessionId, status }: { sessionId: string; status: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancellable = CANCELLABLE_STATUSES.includes(status);
  if (!cancellable) return null;

  const handleCancel = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/roleplays/${sessionId}`, { method: 'PATCH' });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success) throw new Error(body?.error || 'Failed to cancel session');
        setConfirming(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to cancel session');
        setConfirming(false);
      }
    });
  };

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            className="px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-sm font-medium border border-white/10 transition-colors"
          >
            Keep
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isPending}
            className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isPending ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
            Confirm cancel
          </button>
        </div>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      title="Cancel this session so the participant can be invited again"
      className={cn(
        'px-4 py-2 rounded-xl font-medium transition-colors border text-sm',
        'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20'
      )}
    >
      Cancel
    </button>
  );
}
