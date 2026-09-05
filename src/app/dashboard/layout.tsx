import { DashboardShell } from "@/components/DashboardShell";
import { auth } from '@/lib/auth';
import { getCurrentProfile } from '@/app/actions/auth';
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { getMonthBounds, sumEffectiveLogMinutes } from '@/lib/interpreter-metrics';
import HeartbeatProvider from "@/components/HeartbeatProvider";
import ActivityTrackerClient from "@/components/ActivityTrackerClient";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {

  const { userId } = await auth();
  if (!userId) redirect('/login');

  const profile = await getCurrentProfile();

  if (profile && profile.role === 'admin') {
    redirect('/admin');
  }

  const notificationUserIds = [userId];
  if (profile?.id && profile.id !== userId) {
    notificationUserIds.push(profile.id);
  }

  // ── ROBUSTNESS GUARD ─────────────────────────────────────────
  // Notification.userId is @db.Uuid. The local-RBAC login flow (NextAuth
  // credentials against rbac_users) produces NON-UUID ids (cuid). Passing
  // those to `user_id = ANY($1::uuid[])` throws "invalid input syntax for
  // type uuid" → 500 on /dashboard. Filter to real UUIDs only so the
  // notification panel silently returns empty instead of crashing the page.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const uuidUserIds = notificationUserIds.filter((id) => id && UUID_RE.test(id));

  const db = prisma as any;
  const notifications =
    uuidUserIds.length > 0
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

  // ── Compute ranking data for the sidebar ──
  let ranking = null;
  if (profile?.interpreter_id) {
    try {
      const { startOfMonth, endOfMonth } = getMonthBounds();

      // Get all interpreters' monthly minutes and latest QA for ranking
      const allInterpreters = await db.interpreter.findMany({
        select: {
          id: true,
          productionLogs: {
            where: {
              date: { gte: startOfMonth, lte: endOfMonth },
            },
            select: { interpretedMinutes: true, verifiedMinutes: true },
          },
          qaScores: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { totalScore: true }
          }
        },
      });

      // Calculate total minutes and get latest QA for each interpreter
      const rankings = allInterpreters.map((interp: any) => {
        const logMin = sumEffectiveLogMinutes(interp.productionLogs);
        const latestQa = interp.qaScores?.[0]?.totalScore ? Number(interp.qaScores[0].totalScore) : 0;

        return {
          id: interp.id,
          totalMinutes: logMin,
          qaScore: latestQa
        };
      });

      // Sort descending (Minutes desc, then QA Score desc as tiebreaker)
      rankings.sort((a: any, b: any) => {
        if (b.totalMinutes !== a.totalMinutes) {
          return b.totalMinutes - a.totalMinutes;
        }
        return b.qaScore - a.qaScore;
      });

      const myEntry = rankings.find((r: any) => r.id === profile.interpreter_id);
      const myPosition = rankings.findIndex((r: any) => r.id === profile.interpreter_id) + 1;
      const totalMinutesAll = rankings.reduce((s: number, r: any) => s + r.totalMinutes, 0);
      const avgMinutes = rankings.length > 0 ? Math.round(totalMinutesAll / rankings.length) : 0;

      ranking = {
        position: myPosition || rankings.length,
        totalInterpreters: rankings.length,
        myMinutes: myEntry?.totalMinutes || 0,
        avgMinutes,
      };
    } catch (error) {
      console.error('❌ LAYOUT: Ranking calculation failed:', error);
    }
  }

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