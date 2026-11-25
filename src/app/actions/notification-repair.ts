'use server';

import { validateAction } from '@/lib/auth/actions';
import { rateLimit } from '@/lib/security/rate-limit';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { repairMessageNotifications } from '@/lib/notifications/repair-message-notifications';

export async function repairMissingMessageNotices(confirmed: unknown) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false as const, code: 'UNAUTHORIZED' };
  if (confirmed !== true) return { success: false as const, code: 'CONFIRMATION_REQUIRED' };
  try {
    const limit = rateLimit(auth.user.userId, { maxRequests: 1, windowMs: 60_000, keyPrefix: 'notification-repair' });
    if (!limit.success) return { success: false as const, code: 'RATE_LIMITED' };
    const report = await repairMessageNotifications();
    console.info('Administrative message notification repair completed:', {
      sampled: report.sampled, created: report.created, conflicts: report.conflicts,
    });
    return { success: true as const, report };
  } catch (error) {
    console.warn('Message notification repair unavailable:', safeServerErrorCategory(error));
    return { success: false as const, code: 'UNAVAILABLE' };
  }
}
