import 'server-only';
import prisma from '@/lib/prisma';
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
    const score = input.totalScore;
    const delivery = await createNotification({
      userId: profile.id,
      eventKey: 'qa.evaluation:' + input.evaluationId,
      category: 'qa',
      title: 'Evaluación QA Lista',
      message: `Tu puntaje de sesión: ${score.toFixed(1)}%. Acción: ${input.actionRequired}`,
      type: score >= 85 ? 'success' : score >= 70 ? 'info' : 'warning',
      link: '/dashboard',
    });
    if (delivery?.success === false) console.warn('QA saved but notification not delivered');
  } catch (error) {
    console.error('Notification failed but QA saved:', safeServerErrorCategory(error));
  }
}
