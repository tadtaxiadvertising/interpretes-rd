import type { RecruitmentEmailKind } from './recruitment-templates';

export const EMAIL_DELIVERY_STATUSES = ['pending', 'sending', 'accepted', 'unconfirmed', 'cancelled'] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];
export type EmailHistoryRow = {
  kind: RecruitmentEmailKind;
  status: EmailDeliveryStatus;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
};
export type EmailHistoryReport =
  | { status: 'ready'; rows: EmailHistoryRow[] }
  | { status: 'not_installed' | 'unavailable' | 'unauthorized' };
