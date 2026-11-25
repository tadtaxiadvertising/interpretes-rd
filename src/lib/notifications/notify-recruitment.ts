import 'server-only';
import prisma from '@/lib/prisma';
import { notificationEventRow } from './notification-event-row';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

export type RecruitmentAdminMilestone =
  | { kind: 'application-created'; applicationId: string }
  | { kind: 'roleplay-review'; applicationId: string; version: number }
  | { kind: 'interview-pending'; applicationId: string; version: number };

export function recruitmentAdminEventRow(userId: string, milestone: RecruitmentAdminMilestone) {
  const content = {
    'application-created': { title: 'Nueva postulación', message: 'Se registró una nueva solicitud de empleo. Revísala en Reclutamiento.' },
    'roleplay-review': { title: 'Roleplay pendiente de revisión', message: 'Una postulación tiene un roleplay enviado para evaluación.' },
    'interview-pending': { title: 'Entrevista pendiente', message: 'Una postulación avanzó a la etapa de entrevista.' },
  }[milestone.kind];
  const eventKey = 'recruitment:' + milestone.kind + ':' + milestone.applicationId +
    ('version' in milestone ? ':' + milestone.version : '');

  return notificationEventRow({ userId, eventKey, category: 'recruitment', type: 'info', ...content, link: '/recruitment' });
}

/** Only call after the corresponding recruitment transaction commits. */
export async function notifyRecruitmentAdmins(milestone: RecruitmentAdminMilestone): Promise<void> {
  try {
    const admins = await prisma.userProfile.findMany({
      where: { role: { equals: 'admin', mode: 'insensitive' } },
      select: { id: true },
    });
    for (let offset = 0; offset < admins.length; offset += 100) {
      await prisma.notification.createMany({
        data: admins.slice(offset, offset + 100).map(admin => recruitmentAdminEventRow(admin.id, milestone)),
        skipDuplicates: true,
      });
    }
  } catch (error) {
    console.warn('Recruitment milestone saved but notification failed:', safeServerErrorCategory(error));
  }
}
