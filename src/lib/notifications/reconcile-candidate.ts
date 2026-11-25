import 'server-only';
import prisma from '@/lib/prisma';
import { candidateNotificationEvent } from './notify-candidate';
import { publishNotificationEvent } from './publish-notification-event';
import { authorizedNotificationRecipientIds } from './authorized-recipient-ids';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import type { CurrentActor } from '@/lib/auth/current-actor';

const INTERVAL_MS = 5 * 60_000;
const WINDOW_MS = 24 * 60 * 60_000;
const MAX_SCOPES = 256;
type Scan = { attemptedAt: number; inFlight: boolean };
const scans = new Map<string, Scan>();

/** Internal recovery for an authenticated actor, not a client-supplied identity. */
export async function reconcileCandidateNotifications(actor: CurrentActor, nowMs = Date.now()): Promise<void> {
  if (actor.role !== 'candidate' || !actor.candidateId || !Number.isSafeInteger(actor.candidateId) ||
      actor.candidateId <= 0 || !actor.profileId || !actor.email ||
      !authorizedNotificationRecipientIds(null, actor.profileId).length) return;
  const key = actor.profileId.toLowerCase() + ':' + actor.candidateId;
  let scan = scans.get(key);
  if (scan && (scan.inFlight || nowMs - scan.attemptedAt < INTERVAL_MS)) return;
  if (!scan) {
    if (scans.size >= MAX_SCOPES) {
      const evictable = [...scans].find(([, value]) => !value.inFlight);
      if (!evictable) return;
      scans.delete(evictable[0]);
    }
    scan = { attemptedAt: nowMs, inFlight: false };
  }
  scan.attemptedAt = nowMs;
  scan.inFlight = true;
  scans.delete(key);
  scans.set(key, scan);

  try {
    const email = actor.email.trim().toLowerCase();
    const profile = await prisma.userProfile.findUnique({
      where: { id: actor.profileId },
      select: { id: true, email: true, role: true, interpreterId: true },
    });
    if (profile?.role?.toLowerCase() !== 'candidate' || profile.interpreterId !== null ||
        profile.email?.trim().toLowerCase() !== email) return;

    const application = await prisma.recruitmentApplication.findUnique({
      where: { candidateId: actor.candidateId },
      select: {
        id: true, status: true, version: true, candidate: { select: { email: true } },
        events: {
          select: { eventType: true, fromStatus: true, toStatus: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
    });
    if (!application || application.candidate.email.trim().toLowerCase() !== email) return;
    const event = application.events[0];
    if (!event || event.toStatus !== application.status ||
        event.createdAt.getTime() < nowMs - WINDOW_MS || event.createdAt.getTime() > nowMs) return;
    if (application.status === 'APPLIED') {
      if (application.version !== 0 || event.eventType !== 'APPLICATION_CREATED' || event.fromStatus !== null) return;
    } else if (application.version <= 0 || event.fromStatus === null || event.fromStatus === event.toStatus) return;

    const notice = candidateNotificationEvent(profile.id, {
      applicationId: application.id, status: application.status, version: application.version,
    });
    if (notice) await publishNotificationEvent(notice);
  } catch (error) {
    console.warn('Candidate notification reconciliation failed:', safeServerErrorCategory(error));
  } finally {
    scan.inFlight = false;
  }
}
