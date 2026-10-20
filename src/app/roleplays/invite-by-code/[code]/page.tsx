'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, AlertCircle, CheckCircle2, Mic2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function InviteByCodePage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function validateInvite() {
      try {
        const res = await fetch('/api/roleplay/validate-invite-by-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inviteCode: code }),
        });
        const data = await res.json();
        if (data.success) {
          setStatus('success');
          router.push(`/roleplays/${data.data.sessionId}`);
        } else {
          setStatus('error');
          setError(data.error || 'Invalid invitation');
        }
      } catch {
        setStatus('error');
        setError('Failed to validate invitation');
      }
    }
    validateInvite();
  }, [code, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="glass p-12 rounded-3xl border border-white/5 text-center max-w-md">
          <div className="w-20 h-20 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Loader2 size={40} className="animate-spin text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Validating Invitation</h2>
          <p className="text-gray-400">Please wait while we verify your access...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="glass p-12 rounded-3xl border border-white/5 text-center max-w-md">
          <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={40} className="text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Invalid Invitation</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <a 
            href="/login" 
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors"
          >
            <Mic2 size={18} />
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  return null;
}