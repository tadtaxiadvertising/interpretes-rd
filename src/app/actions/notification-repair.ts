'use server';

import { validateAction } from '@/lib/auth/actions';
import { rateLimit } from '@/lib/security/rate-limit';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { operationalNotificationModules, type OperationalNotificationModule } from '@/lib/notifications/operational-notification-diagnostics';
import { repairOperationalNotifications } from '@/lib/notifications/repair-operational-notifications';
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

export async function repairMissingOperationalNotices(module: unknown, confirmed: unknown) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false as const, code: 'UNAUTHORIZED' };
  if (confirmed !== true) return { success: false as const, code: 'CONFIRMATION_REQUIRED' };
  if (typeof module !== 'string' || !operationalNotificationModules.some(value => value === module)) {
    return { success: false as const, code: 'INVALID_MODULE' };
  }
  try {
    // Same quota as message repair; switching modules cannot bypass it.
    const limit = rateLimit(auth.user.userId, { maxRequests: 1, windowMs: 60_000, keyPrefix: 'notification-repair' });
    if (!limit.success) return { success: false as const, code: 'RATE_LIMITED' };
    const report = await repairOperationalNotifications(module as OperationalNotificationModule);
    console.info('Administrative operational notification repair completed:', {
      module: report.module, eligible: report.eligible, created: report.created, conflicts: report.conflicts,
    });
    return { success: true as const, report };
  } catch (error) {
    console.warn('Operational notification repair unavailable:', safeServerErrorCategory(error));
    return { success: false as const, code: 'UNAVAILABLE' };
  }
}
