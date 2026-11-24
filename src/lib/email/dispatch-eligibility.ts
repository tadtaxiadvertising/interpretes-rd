import { emailKindForEvent, type EmailEvent } from './recruitment-event-policy';
import type { RecruitmentApplicationStatus } from '@/lib/prisma-types';
import type { RecruitmentEmailKind } from './recruitment-templates';

const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

export type DispatchSnapshot = {
  event: EmailEvent & { createdAt: Date };
  application: { id: string; status: RecruitmentApplicationStatus; candidateId: number; email: string };
  // Must originate from a trusted immutable account-to-candidate binding
  // and a fresh authoritative Auth lookup, NOT from a form or email match.
  identity: { candidateId: number; accountId: string; email: string; verified: boolean; active: boolean } | null;
};

export type Eligibility =
  | { status: 'eligible'; kind: RecruitmentEmailKind; recipient: string }
  | { status: 'ineligible' | 'expired' | 'identity_unverified' };

const normalize = (email: string) => email.trim().toLowerCase();
const validAddress = (email: string) => email.length <= 254 && /^[a-zA-Z0-9.!#$%&'*+/=?^_~|-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(email);

export function evaluateDispatch(snapshot: DispatchSnapshot, now: Date): Eligibility {
  const { event, application, identity } = snapshot;
  const kind = emailKindForEvent(event);
  if (!kind || application.id !== event.applicationId || application.status !== event.toStatus) {
    return { status: 'ineligible' };
  }
  const age = now.getTime() - event.createdAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age > MAX_EVENT_AGE_MS) return { status: 'expired' };
  if (!identity || !identity.verified || !identity.active || !identity.accountId
    || identity.candidateId !== application.candidateId
    || !validAddress(identity.email)
    || normalize(identity.email) !== normalize(application.email)) return { status: 'identity_unverified' };
  return { status: 'eligible', kind, recipient: normalize(identity.email) };
}
