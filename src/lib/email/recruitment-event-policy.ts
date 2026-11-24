import type { RecruitmentApplicationStatus, RecruitmentEventType } from '@/lib/prisma-types';
import type { RecruitmentEmailKind } from './recruitment-templates';

export type EmailEvent = {
  id: string;
  applicationId: string;
  eventType: RecruitmentEventType;
  toStatus: RecruitmentApplicationStatus;
};

/**
 * Explicit allowlist of persisted recruitment events. Not a sending trigger.
 * Evaluation outcomes and other sensitive information stay inside the portal.
 * The dispatcher must independently check the current application state and
 * recipient ownership; never derive a destination from actorId or metadata.
 */
export function emailKindForEvent(event: EmailEvent): RecruitmentEmailKind | null {
  if (!event.id || !event.applicationId) return null;
  if (event.eventType === 'APPLICATION_CREATED' && event.toStatus === 'APPLIED') {
    return 'application_received';
  }
  if (event.eventType === 'INDUCTION_COMPLETED' && event.toStatus === 'ROLEPLAY_PENDING') {
    return 'roleplay_ready';
  }
  if (event.eventType === 'ROLEPLAY_PASSED' && event.toStatus === 'INTERVIEW_PENDING') {
    return 'interview_pending';
  }
  return null;
}
