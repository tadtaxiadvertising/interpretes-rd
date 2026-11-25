import 'server-only';
import prisma from '@/lib/prisma';
import { authorizedNotificationRecipientIds } from './authorized-recipient-ids';
import { recruitmentAdminEventRow, type RecruitmentAdminMilestone } from './notify-recruitment';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const WINDOW_MS = 24 * 60 * 60_000;
const INTERVAL_MS = 5 * 60_000;
const PAGE_SIZE = 50;
const MAX_SCOPES = 256;

type Scan = { attemptedAt: number; cursor: string | null; inFlight: boolean };
const scans = new Map<string, Scan>();

/**
 * Reconcile only the requesting admin's inbox. Caller must authenticate the
 * actor and supply their trusted profile ID, never a client-provided ID.
 * Process-local throttling is bounded and is not a distributed scheduler.
 */
export async function reconcileRecruitmentAdminNotifications(profileId: string, nowMs = Date.now()): Promise<void> {
  if (!authorizedNotificationRecipientIds(null, profileId).length) return;
  const key = profileId.toLowerCase();
  let scan = scans.get(key);
  if (scan && (scan.inFlight || nowMs - scan.attemptedAt < INTERVAL_MS)) return;
  if (!scan) {
    if (scans.size >= MAX_SCOPES) {
      const oldest = scans.keys().next().value;
      if (oldest !== undefined) scans.delete(oldest);
    }
    scan = { attemptedAt: nowMs, cursor: null, inFlight: false };
  }
  scan.attemptedAt = nowMs;
  scan.inFlight = true;
  scans.delete(key);
  scans.set(key, scan);

  try {
    const profile = await prisma.userProfile.findUnique({
      where: { id: profileId }, select: { id: true, role: true },
    });
    if (profile?.role?.toLowerCase() !== 'admin') return;

    const lower = new Date(nowMs - WINDOW_MS);
    const upper = new Date(nowMs);
    const recent = { gte: lower, lte: upper };
    const applications = await prisma.recruitmentApplication.findMany({
      where: {
        ...(scan.cursor ? { id: { gt: scan.cursor } } : {}),
        OR: [
          { status: 'APPLIED', createdAt: recent },
          { status: { in: ['ROLEPLAY_REVIEW', 'INTERVIEW_PENDING'] }, lastActivityAt: recent },
        ],
      },
      select: {
        id: true, status: true, version: true,
        events: {
          select: { eventType: true, fromStatus: true, toStatus: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
    });

    const rows: ReturnType<typeof recruitmentAdminEventRow>[] = [];
    for (const application of applications) {
      const event = application.events[0];
      // Current, recent audited transitions only. Never recreate stale
      // milestones from an earlier stage or infer a version from event order.
      if (!event || event.toStatus !== application.status ||
          event.createdAt < lower || event.createdAt > upper) continue;
      let milestone: RecruitmentAdminMilestone | null = null;
      if (application.status === 'APPLIED' && application.version === 0 &&
          event.eventType === 'APPLICATION_CREATED' && event.fromStatus === null) {
        milestone = { kind: 'application-created', applicationId: application.id };
      } else if (application.version > 0 && event.fromStatus !== null && event.fromStatus !== event.toStatus) {
        if (application.status === 'ROLEPLAY_REVIEW') {
          milestone = { kind: 'roleplay-review', applicationId: application.id, version: application.version };
        } else if (application.status === 'INTERVIEW_PENDING') {
          milestone = { kind: 'interview-pending', applicationId: application.id, version: application.version };
        }
      }
      if (milestone) rows.push(recruitmentAdminEventRow(profile.id, milestone));
    }

    if (rows.length) await prisma.notification.createMany({ data: rows, skipDuplicates: true });
    // Preserve cursor on failed inserts; wrap when the current pass ends.
    scan.cursor = applications.length === PAGE_SIZE ? applications[applications.length - 1].id : null;
  } catch (error) {
    console.warn('Recruitment notification reconciliation failed:', safeServerErrorCategory(error));
  } finally {
    scan.inFlight = false;
  }
}
