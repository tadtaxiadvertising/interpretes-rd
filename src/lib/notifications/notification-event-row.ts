import { createHash } from 'node:crypto';
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

/**
 * Node-only projection shared by the web server and standalone audio worker.
 * No Next.js runtime dependency. The caller must resolve authorized recipients.
 */
export function notificationEventRow(event: NotificationEvent) {
  const id = createHash('sha256').update(JSON.stringify(['notification-event-v1', event.userId.toLowerCase(), event.eventKey])).digest('hex');
  return {
    id, userId: event.userId, title: event.title, message: event.message,
    category: event.category, type: event.type, link: safeNotificationLink(event.link),
  };
}
