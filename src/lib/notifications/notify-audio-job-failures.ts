import prisma from '@/lib/prisma';
import { notificationEventRow } from './notification-event-row';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

type TerminalFailure = { id: string; failedAt: Date };

/** Only call after a terminal failure transition has committed. */
export async function notifyAudioJobFailures(failures: readonly TerminalFailure[]): Promise<void> {
  if (!failures.length) return;
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
  } catch (error) {
    // Notification failure must never change a committed job state.
    console.warn('[ROLEPLAY AUDIO WORKER] Terminal notification failed:', safeServerErrorCategory(error));
  }
}
