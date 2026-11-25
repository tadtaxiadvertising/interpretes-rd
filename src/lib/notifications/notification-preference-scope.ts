import 'server-only';
import { createHash } from 'node:crypto';

export function notificationPreferenceScope(userId: string | null | undefined, role: string): string | undefined {
  if (!userId) return undefined;
  return createHash('sha256').update(JSON.stringify(['notification-view-v1', userId, role])).digest('hex');
}
