import { DashboardShell } from '@/components/DashboardShell';
import { requireAdminNotificationContext } from '@/lib/notifications/admin-notification-context';

export const dynamic = 'force-dynamic';

export default async function QALayout({ children }: { children: React.ReactNode }) {
  const context = await requireAdminNotificationContext();
  return (
    <DashboardShell role="admin" {...context}>
      {children}
    </DashboardShell>
  );
}
