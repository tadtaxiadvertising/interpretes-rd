import { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import prisma from '@/lib/prisma';

export const metadata: Metadata = {
  title: 'Loading...',
};

interface PageProps {
  params: Promise<{ code: string }>;
}

export default async function ShortInviteRedirect({ params }: PageProps) {
  const { code } = await params;
  const inviteCode = code.toUpperCase();

  const access = await prisma.roleplayAccess.findUnique({
    where: { inviteCode },
    include: { session: true },
  });

  if (!access) {
    notFound();
  }

  if (access.usedAt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="glass p-12 rounded-3xl border border-white/5 text-center max-w-md">
          <div className="w-20 h-20 bg-yellow-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Enlace ya utilizado</h2>
          <p className="text-gray-400">Esta invitación ya fue canjeada anteriormente.</p>
        </div>
      </div>
    );
  }

  if (access.expiresAt < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="glass p-12 rounded-3xl border border-white/5 text-center max-w-md">
          <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Enlace expirado</h2>
          <p className="text-gray-400">Esta invitación ha caducado. Contacta al administrador para una nueva.</p>
        </div>
      </div>
    );
  }

  if (!['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS'].includes(access.session.status)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="glass p-12 rounded-3xl border border-white/5 text-center max-w-md">
          <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Sesión no disponible</h2>
          <p className="text-gray-400">Este roleplay ya no está en estado pendiente.</p>
        </div>
      </div>
    );
  }

  // Redirect to the full invite validation page with the raw token
  // We need to get the raw token - but we only have the hash
  // Instead, redirect to a page that validates by inviteCode
  redirect(`/roleplays/invite-by-code/${inviteCode}`);
}