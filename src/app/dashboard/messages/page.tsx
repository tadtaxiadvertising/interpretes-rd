import React from 'react';
import { getCurrentUser } from '@/lib/auth/actions';
import { redirect } from 'next/navigation';
import { ChatSystem } from '@/components/ChatSystem';

export const dynamic = 'force-dynamic';

export default async function InterpreterMessagesPage() {
  const userData = await getCurrentUser();
  if (!userData) redirect('/login');

  const profile = userData.profile;

  // Case-insensitive role check
  if (profile?.role?.toLowerCase() !== 'interpreter') {
    redirect('/unauthorized');
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--foreground)]">Soporte y Mensajería</h1>
        <p className="text-[var(--text-secondary)] mt-2">
          Comunícate de forma directa y segura con el equipo de administración.
        </p>
      </div>

      <ChatSystem currentUserId={userData.id} currentUserRole="interpreter" />
    </div>
  );
}
