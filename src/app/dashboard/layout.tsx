import { DashboardShell } from "@/components/DashboardShell";
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getResolvedIdentity } from '@/lib/auth/actions';
import { resolveDestination } from '@/lib/identity/resolve-user';
import { getCurrentProfile } from '@/app/actions/auth';
import { loadNavbarNotifications } from '@/lib/notifications/load-navbar-notifications';
import { authorizedNotificationRecipientIds } from '@/lib/notifications/authorized-recipient-ids';
import HeartbeatProvider from "@/components/HeartbeatProvider";
import ActivityTrackerClient from "@/components/ActivityTrackerClient";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) return null; // Entry router handles auth, but keep guard

  // Enforce the onboarding/roleplay gate on the server for every dashboard
  // sub-route. A client-only wizard or entry router can be bypassed by opening
  // a nested dashboard URL directly.
  const identity = await getResolvedIdentity();
  if (identity?.role === 'candidate') {
    redirect(resolveDestination(identity));
  }

  if (identity && identity.role !== 'admin') {
    const destination = resolveDestination(identity);
    if (destination.startsWith('/onboarding') || destination.startsWith('/roleplays/')) {
      redirect(destination);
    }
    if (destination === '/dashboard/roleplays') {
      redirect('/recruitment');
    }
  }

  const profile = await getCurrentProfile();

  // Entry router handles admin redirect, but keep as safety
  if (profile && profile.role === 'admin') {
    return null;
  }

  // Match the trusted recipient IDs used by markNotificationAsRead.
  // Auth.js account UUIDs may differ from their linked profile UUIDs.
  const recipientIds = authorizedNotificationRecipientIds(userId, profile?.id);
  const notifications = await loadNavbarNotifications(recipientIds);

  // Ranking removed from layout - will be fetched client-side or via API
  // This eliminates the N+1 query problem that caused build timeouts
  const ranking = null;

  return (
    <HeartbeatProvider>
      <ActivityTrackerClient interpreterId={profile?.interpreter_id} />
      <DashboardShell
        role="interpreter"
        userName={profile?.display_name || "Intérprete"}
        interpreterId={profile?.interpreter_id}
        userEmail={profile?.email || ''}
        notifications={notifications}
        ranking={ranking}
      >
        {children}
      </DashboardShell>
    </HeartbeatProvider>
  );
}