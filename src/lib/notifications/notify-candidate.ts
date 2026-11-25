import 'server-only';
import prisma from '@/lib/prisma';
import { publishNotificationEvent } from './publish-notification-event';
import { authorizedNotificationRecipientIds } from './authorized-recipient-ids';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import type { RecruitmentApplicationStatus } from '@/lib/prisma-types';

const content: Partial<Record<RecruitmentApplicationStatus, { title: string; message: string; type: 'info' | 'success' | 'warning' }>> = {
  APPLIED: { title: 'Postulación recibida', message: 'Tu solicitud está registrada. Consulta los próximos pasos en tu portal.', type: 'success' },
  DOCUMENTS_PENDING: { title: 'Etapa de documentación', message: 'Consulta las indicaciones de tu expediente para continuar.', type: 'info' },
  ROLEPLAY_REVIEW: { title: 'Roleplay en revisión', message: 'Tu solicitud avanzó a revisión. Consulta tu portal para conocer el estado.', type: 'info' },
  INTERVIEW_PENDING: { title: 'Etapa de entrevista', message: 'Tu proceso avanzó a la etapa de entrevista. Consulta tu portal para conocer los próximos pasos.', type: 'success' },
  INTERVIEW_SCHEDULED: { title: 'Entrevista programada', message: 'Tu proceso registra una entrevista programada. Consulta las indicaciones del equipo de reclutamiento.', type: 'info' },
  OFFER_SENT: { title: 'Actualización de oferta', message: 'Tu expediente registra una oferta enviada. Consulta las indicaciones del equipo de reclutamiento.', type: 'info' },
  CONTRACT_PENDING: { title: 'Etapa de contrato', message: 'Tu proceso avanzó a la etapa de contrato. Consulta las indicaciones correspondientes.', type: 'info' },
  REJECTED: { title: 'Actualización de tu postulación', message: 'El estado de tu solicitud cambió. Consulta tu portal privado.', type: 'info' },
};

/** Called after commit. Never accept an email or recipient ID from the caller. */
export async function notifyCandidateMilestone(input: { applicationId: string; status: RecruitmentApplicationStatus; version: number }): Promise<void> {
  const notice = content[input.status];
  if (!notice) return;
  try {
    // Do not publish an older milestone after another transition has won.
    const application = await prisma.recruitmentApplication.findUnique({
      where: { id: input.applicationId },
      select: { status: true, version: true, candidate: { select: { email: true } } },
    });
    if (!application || application.status !== input.status || application.version !== input.version) return;
    const profile = await prisma.userProfile.findUnique({
      where: { email: application.candidate.email },
      select: { id: true, role: true, interpreterId: true },
    });
    // Only a provisioned candidate profile; never send to an administrative
    // or operational account, or invent a recipient for an unlinked applicant.
    if (profile?.role?.toLowerCase() !== 'candidate' || profile.interpreterId !== null) return;
    const [userId] = authorizedNotificationRecipientIds(null, profile.id);
    if (!userId) return;
    await publishNotificationEvent({
      userId, eventKey: 'recruitment.candidate:' + input.applicationId + ':' + input.version + ':' + input.status,
      category: 'recruitment', link: '/candidate', ...notice,
    });
  } catch (error) {
    console.warn('Candidate milestone saved but notification failed:', safeServerErrorCategory(error));
  }
}
