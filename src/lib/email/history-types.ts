import type { ProviderId } from './provider-catalog';
import type { RecruitmentEmailKind } from './recruitment-templates';

export const EMAIL_DELIVERY_STATUSES = ['pending', 'sending', 'accepted', 'unconfirmed', 'cancelled'] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];
export type DeliveryProvider = ProviderId | 'smtp';
export type EmailHistoryRow = {
  provider: DeliveryProvider | null;
  kind: RecruitmentEmailKind;
  status: EmailDeliveryStatus;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
};
export type EmailHistoryReport =
  | { status: 'ready'; rows: EmailHistoryRow[] }
  | { status: 'not_installed' | 'unavailable' | 'unauthorized' };
