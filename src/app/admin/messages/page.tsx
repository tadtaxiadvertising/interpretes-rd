import React from 'react';
import { getCurrentUser } from '@/lib/auth/actions';
import { redirect } from 'next/navigation';
import { ChatSystem } from '@/components/ChatSystem';

export const dynamic = 'force-dynamic';

export default async function AdminMessagesPage() {
  const userData = await getCurrentUser();
  if (!userData) redirect('/login');

  const profile = userData.profile;

  // Case-insensitive role check
  if (profile?.role?.toLowerCase() !== 'admin') {
    redirect('/unauthorized');
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--foreground)]">Mensajería y Soporte</h1>
        <p className="text-[var(--text-secondary)] mt-2">
          Chat en tiempo real con los intérpretes de la plataforma.
        </p>
      </div>

      <ChatSystem currentUserId={userData.id} currentUserRole="admin" />
    </div>
  );
}
