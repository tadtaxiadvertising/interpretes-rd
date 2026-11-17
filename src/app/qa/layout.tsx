import { DashboardShell } from '@/components/DashboardShell';
import { getCurrentProfile } from '@/app/actions/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function QALayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  // Protect the entire QA route tree before mounting the administrative shell.
  // Use the same resolved profile guard as /admin and /recruitment.
  if (!profile) redirect('/login');
  if (profile.role !== 'admin') redirect('/dashboard');

  return (
    <DashboardShell role="admin" userName={profile.display_name || 'Administrador'}>
      {children}
    </DashboardShell>
  );
}
