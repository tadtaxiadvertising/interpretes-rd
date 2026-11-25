import 'server-only';
import prisma from '@/lib/prisma';
import type { CurrentActor } from '@/lib/auth/current-actor';
import { authorizedNotificationRecipientIds } from './authorized-recipient-ids';
import { notificationEventRow } from './notification-event-row';
import { qaEvaluationEvent, roleplayEvaluationEvent } from './evaluation-notification-events';
import { ROLEPLAY_PASS_THRESHOLD } from '@/lib/roleplay/scoring';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const INTERVAL_MS = 300_000;
const WINDOW_MS = 86_400_000;
const PAGE_SIZE = 50;
const MAX_SCOPES = 256;
type Scan = { attemptedAt: number; inFlight: boolean; cursor: number | null };
const scans = new Map<string, Scan>();

/** Internal-only: recover the authenticated interpreter's own saved evaluations. */
export async function reconcileInterpreterEvaluations(actor: CurrentActor, nowMs = Date.now()): Promise<void> {
  if (actor.role !== 'interpreter' || !actor.interpreterId || !Number.isSafeInteger(actor.interpreterId) ||
      actor.interpreterId <= 0 || !actor.profileId || !actor.email ||
      !authorizedNotificationRecipientIds(null, actor.profileId).length) return;
  const key = actor.profileId.toLowerCase() + ':' + actor.interpreterId;
  let scan = scans.get(key);
  if (scan && (scan.inFlight || nowMs - scan.attemptedAt < INTERVAL_MS)) return;
  if (!scan) {
    if (scans.size >= MAX_SCOPES) {
      const evictable = [...scans].find(([, value]) => !value.inFlight);
      if (!evictable) return;
      scans.delete(evictable[0]);
    }
    scan = { attemptedAt: nowMs, inFlight: false, cursor: null };
  }
  scan.attemptedAt = nowMs;
  scan.inFlight = true;
  scans.delete(key);
  scans.set(key, scan);

  try {
    const profile = await prisma.userProfile.findUnique({
      where: { id: actor.profileId },
      select: { id: true, role: true, interpreterId: true, email: true },
    });
    if (profile?.role?.toLowerCase() !== 'interpreter' ||
        profile.interpreterId !== actor.interpreterId ||
        profile.email.trim().toLowerCase() !== actor.email.trim().toLowerCase()) return;

    const recent = { gte: new Date(nowMs - WINDOW_MS), lte: new Date(nowMs) };
    const scores = await prisma.qAScore.findMany({
      where: {
        interpreterId: actor.interpreterId,
        ...(scan.cursor !== null ? { id: { gt: scan.cursor } } : {}),
        createdAt: recent,
        totalScore: { not: null },
        OR: [
          { roleplaySession: { is: null } },
          { roleplaySession: { is: {
            interpreterId: actor.interpreterId, recruitmentCandidateId: null,
            status: 'EVALUATED', evaluatedAt: recent,
          } } },
        ],
      },
      select: {
        id: true, totalScore: true, criticalError: true, accionRequerida: true,
        roleplaySession: { select: { id: true, interpreterId: true, recruitmentCandidateId: true, status: true } },
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
    });

    const rows: ReturnType<typeof notificationEventRow>[] = [];
    for (const score of scores) {
      if (score.totalScore === null) continue;
      const totalScore = Number(score.totalScore);
      if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > 100) continue;
      // Only canonical action labels; do not replay legacy free-text notes.
      const actionRequired = score.accionRequerida;
      if (actionRequired !== 'Ninguna' && actionRequired !== 'Feedback Requerido' &&
          actionRequired !== 'Advertencia / Coaching') continue;
      const session = score.roleplaySession;
      if (session) {
        if (session.recruitmentCandidateId !== null || session.interpreterId !== actor.interpreterId ||
            session.status !== 'EVALUATED') continue;
        rows.push(notificationEventRow(roleplayEvaluationEvent(profile.id, {
          sessionId: session.id, totalScore, actionRequired,
          passed: score.criticalError !== true && totalScore >= ROLEPLAY_PASS_THRESHOLD,
        })));
      } else {
        rows.push(notificationEventRow(qaEvaluationEvent(profile.id, {
          evaluationId: score.id, totalScore, actionRequired,
        })));
      }
    }
    if (rows.length) await prisma.notification.createMany({ data: rows, skipDuplicates: true });
    scan.cursor = scores.length === PAGE_SIZE ? scores[scores.length - 1].id : null;
  } catch (error) {
    console.warn('Interpreter evaluation notification reconciliation failed:', safeServerErrorCategory(error));
  } finally {
    scan.inFlight = false;
  }
}
