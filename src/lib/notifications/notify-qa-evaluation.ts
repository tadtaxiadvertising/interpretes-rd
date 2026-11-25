import 'server-only';
import prisma from '@/lib/prisma';
import { qaEvaluationEvent } from './evaluation-notification-events';
import { createNotification } from '@/app/actions/notifications';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

/** Best-effort after a verified QA evaluation has committed. */
export async function notifyQaEvaluation(input: { evaluationId: number; interpreterId: number; totalScore: number; actionRequired: string }) {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { interpreterId: input.interpreterId },
      select: { id: true },
    });
    if (!profile) return;
    const delivery = await createNotification(qaEvaluationEvent(profile.id, input));
    if (delivery?.success === false) console.warn('QA saved but notification not delivered');
  } catch (error) {
    console.error('Notification failed but QA saved:', safeServerErrorCategory(error));
  }
}
