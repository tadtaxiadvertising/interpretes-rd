import prisma from '@/lib/prisma';
import { notificationEventRow } from './notification-event-row';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

type TerminalFailure = { id: string; failedAt: Date };

/** Only call after a terminal failure transition has committed. */
export async function notifyAudioJobFailures(failures: readonly TerminalFailure[]): Promise<boolean> {
  if (!failures.length) return true;
  try {
    const admins = await prisma.userProfile.findMany({
      where: { role: { equals: 'admin', mode: 'insensitive' } },
      select: { id: true },
    });
    // A failed job after a manual requeue is a new event. Replaying the
    // same committed failure uses the same key and preserves read state.
    let batch: ReturnType<typeof notificationEventRow>[] = [];
    for (const failure of failures) {
      for (const admin of admins) {
        batch.push(notificationEventRow({
          userId: admin.id,
          eventKey: 'roleplay.audio.failed:' + failure.id + ':' + failure.failedAt.toISOString(),
          category: 'roleplay',
          type: 'error',
          title: 'Procesamiento de audio fallido',
          message: 'Una conversión agotó sus intentos. Revisa los trabajos fallidos en la cola de audio.',
          link: '/admin/roleplay-audio-jobs',
        }));
        if (batch.length >= 100) {
          await prisma.notification.createMany({ data: batch, skipDuplicates: true });
          batch = [];
        }
      }
    }
    if (batch.length) await prisma.notification.createMany({ data: batch, skipDuplicates: true });
    return true;
  } catch (error) {
    // Notification failure must never change a committed job state.
    console.warn('[ROLEPLAY AUDIO WORKER] Terminal notification failed:', safeServerErrorCategory(error));
    return false;
  }
}

export const AUDIO_NOTIFICATION_RECONCILIATION_MS = 5 * 60_000;
const RECOVERY_WINDOW_MS = 24 * 60 * 60_000;
const RECOVERY_BATCH_SIZE = 50;

/**
 * Recover recent terminal jobs whose post-commit notification may have failed.
 * Scan in bounded, stable ID order; a completed pass resets to the beginning.
 * No job mutations, new conversions, emails or raw error details.
 */
export async function reconcileAudioJobNotifications(
  cursor: string | null,
  nowMs: number = Date.now(),
): Promise<string | null> {
  try {
    const jobs = await prisma.roleplayAudioJob.findMany({
      where: {
        status: 'FAILED',
        updatedAt: { gte: new Date(nowMs - RECOVERY_WINDOW_MS), lte: new Date(nowMs) },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, updatedAt: true },
      orderBy: { id: 'asc' },
      take: RECOVERY_BATCH_SIZE,
    });
    // A row may have been requeued or recovered between scans. The persisted
    // failure timestamp identifies the observed terminal transition.
    const delivered = await notifyAudioJobFailures(jobs.map(job => ({ id: job.id, failedAt: job.updatedAt })));
    if (!delivered) return cursor;
    return jobs.length === RECOVERY_BATCH_SIZE ? jobs[jobs.length - 1].id : null;
  } catch (error) {
    console.warn('[ROLEPLAY AUDIO WORKER] Notification reconciliation failed:', safeServerErrorCategory(error));
    return cursor;
  }
}
