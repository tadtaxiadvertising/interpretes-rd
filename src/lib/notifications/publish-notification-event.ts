import 'server-only';
import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';
import { safeNotificationLink } from './safe-notification-link';

export type NotificationEvent = {
  userId: string;
  eventKey: string;
  title: string;
  message: string;
  category: 'system' | 'qa' | 'messaging' | 'roleplay' | 'recruitment' | 'operations' | 'finance';
  type: 'info' | 'success' | 'warning' | 'error';
  link?: string;
};

/** Internal-only: callers must authenticate and resolve the recipient first. */
export async function publishNotificationEvent(event: NotificationEvent) {
  const id = createHash('sha256').update(JSON.stringify(['notification-event-v1', event.userId.toLowerCase(), event.eventKey])).digest('hex');
  // The existing primary key enforces idempotency even across concurrent workers.
  // Never reset a previously read notification or overwrite its original content.
  const result = await prisma.notification.createMany({
    data: [{
      id, userId: event.userId, title: event.title, message: event.message,
      category: event.category, type: event.type,
      link: safeNotificationLink(event.link),
    }],
    skipDuplicates: true,
  });
  return { id, created: result.count === 1 };
}
