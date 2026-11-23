'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, AlertCircle, Mic2 } from 'lucide-react';
import Image from 'next/image';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    async function validateToken() {
      try {
        const res = await fetch('/api/roleplay/validate-invite', {
          method: 'POST',
          referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (data.success) {
          setStatus('success');
          router.push(`/roleplays/${data.data.sessionId}`);
        } else {
          setStatus('error');
          if (res.status === 401) {
            // Never copy an invitation token/code into a login redirect URL.
            // After login, the participant resumes from their own private portal.
            setNeedsLogin(true);
            setError('Inicia sesión con la cuenta a la que se asignó este roleplay. Luego ábrelo desde tu portal privado.');
          } else {
            setError(res.status === 403
              ? 'Esta invitación no corresponde a la cuenta con la que iniciaste sesión.'
              : data.error || 'No se pudo validar la invitación.');
          }
        }
      } catch {
        setStatus('error');
        setError('No pudimos verificar la invitación. Inténtalo nuevamente.');
      }
    }
    validateToken();
  }, [token, router]);

  if (status === 'loading') {
    return (
      <div className="theme-login min-h-screen flex flex-col items-center justify-center bg-[#0a0a0f] px-4">
        <div className="mb-4 flex w-full max-w-md justify-end"><ThemeSwitcher /></div>
        <div className="glass w-full max-w-md rounded-3xl border border-white/5 p-8 text-center sm:p-12">
          <Image src="/interpretes-rd-logo.webp" alt="Intérpretes RD" width={76} height={76} className="mx-auto mb-5 rounded-xl bg-white p-2" />
          <div className="w-20 h-20 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Loader2 size={40} className="animate-spin text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Verificando invitación</h2>
          <p className="text-gray-400">Estamos verificando tu acceso al roleplay.</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="theme-login min-h-screen flex flex-col items-center justify-center bg-[#0a0a0f] px-4">
        <div className="mb-4 flex w-full max-w-md justify-end"><ThemeSwitcher /></div>
        <div className="glass w-full max-w-md rounded-3xl border border-white/5 p-8 text-center sm:p-12">
          <Image src="/interpretes-rd-logo.webp" alt="Intérpretes RD" width={76} height={76} className="mx-auto mb-5 rounded-xl bg-white p-2" />
          <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={40} className="text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{needsLogin ? 'Inicia sesión para continuar' : 'No se pudo validar la invitación'}</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <a
            href="/login"
            referrerPolicy="no-referrer" 
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-[#ffffff] rounded-xl font-bold transition-colors"
          >
            <Mic2 size={18} />
            {needsLogin ? 'Iniciar sesión' : 'Ir al acceso'}
          </a>
        </div>
      </div>
    );
  }

  return null;
}