import 'server-only';
import prisma from '@/lib/prisma';
import { roleplayEvaluationEvent } from './evaluation-notification-events';
import { publishNotificationEvent } from './publish-notification-event';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

type Assignment = { id: string; interpreterId: number };

/** Call only for committed INVITED interpreter sessions, never drafts or candidates. */
export async function notifyRoleplayAssignments(assignments: readonly Assignment[]) {
  if (!assignments.length) return;
  try {
    const profiles = await prisma.userProfile.findMany({
      where: { interpreterId: { in: [...new Set(assignments.map(item => item.interpreterId))] } },
      select: { id: true, interpreterId: true, role: true },
    });
    const recipients = new Map(profiles.filter(profile => profile.role?.toLowerCase() === 'interpreter').map(profile => [profile.interpreterId, profile.id]));
    // Limit concurrent writes and isolate each delivery failure.
    for (let offset = 0; offset < assignments.length; offset += 10) {
      await Promise.allSettled(assignments.slice(offset, offset + 10).map(async assignment => {
        const userId = recipients.get(assignment.interpreterId);
        if (!userId) return;
        try {
          await publishNotificationEvent({
            userId, eventKey: 'roleplay.assigned:' + assignment.id,
            category: 'roleplay', type: 'info', title: 'Nuevo roleplay asignado',
            message: 'Tienes un ejercicio disponible en Mis Roleplays.',
            link: '/dashboard/roleplays',
          });
        } catch (error) {
          console.warn('Roleplay assignment saved but notification failed:', safeServerErrorCategory(error));
        }
      }));
    }
  } catch (error) {
    console.warn('Roleplay assignment notification lookup failed:', safeServerErrorCategory(error));
  }
}

/** Recruitment ownership takes precedence over any legacy interpreter association. */
export async function notifyRoleplayEvaluation(input: {
  sessionId: string; interpreterId: number | null; recruitmentCandidateId: number | null;
  totalScore: number; actionRequired: string; passed: boolean;
}) {
  if (input.recruitmentCandidateId !== null || input.interpreterId === null) return;
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { interpreterId: input.interpreterId },
      select: { id: true, role: true },
    });
    if (profile?.role?.toLowerCase() !== 'interpreter') return;
    await publishNotificationEvent(roleplayEvaluationEvent(profile.id, input));
  } catch (error) {
    console.warn('Roleplay evaluation saved but notification failed:', safeServerErrorCategory(error));
  }
}
