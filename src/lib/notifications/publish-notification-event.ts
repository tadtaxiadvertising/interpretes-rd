import 'server-only';
import prisma from '@/lib/prisma';
import { notificationEventRow, type NotificationEvent } from './notification-event-row';

export type { NotificationEvent } from './notification-event-row';

/** Internal-only: callers must authenticate and resolve the recipient first. */
export async function publishNotificationEvent(event: NotificationEvent) {
  const row = notificationEventRow(event);
  // The existing primary key enforces idempotency even across concurrent workers.
  const result = await prisma.notification.createMany({ data: [row], skipDuplicates: true });
  return { id: row.id, created: result.count === 1 };
}
