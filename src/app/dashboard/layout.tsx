import { DashboardShell } from "@/components/DashboardShell";
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getResolvedIdentity } from '@/lib/auth/actions';
import { resolveDestination } from '@/lib/identity/resolve-user';
import { getCurrentProfile } from '@/app/actions/auth';
import prisma from "@/lib/prisma";
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

  const notificationUserIds = [userId];
  if (profile?.id && profile.id !== userId) {
    notificationUserIds.push(profile.id);
  }

  // ROBUSTNESS GUARD - Filter to real UUIDs only
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const uuidUserIds = notificationUserIds.filter((id) => id && UUID_RE.test(id));

  const db = prisma as any;
  const notifications = uuidUserIds.length > 0
    ? await db.notification
        .findMany({
          where: { userId: { in: uuidUserIds } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        })
        .catch((err: unknown) => {
          console.error('❌ LAYOUT: Notification fetch failed (non-fatal):', err);
          return [];
        })
    : [];

  // Ranking removed from layout - will be fetched client-side or via API
  // This eliminates the N+1 query problem that caused build timeouts
  const ranking = null;

  return (
    <HeartbeatProvider>
      <ActivityTrackerClient interpreterId={profile?.interpreter_id} />
      <DashboardShell
        role="interpreter"
        userName={profile?.display_name || "Interpreter"}
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