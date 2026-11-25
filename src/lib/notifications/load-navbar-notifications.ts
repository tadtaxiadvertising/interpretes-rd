import prisma from '@/lib/prisma';
import { publicNotificationCategory } from './notification-display';
import { safeNotificationLink } from './safe-notification-link';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

/**
 * Expose only presentation fields and sanitized public categories/links.
 * Never serialize recipient IDs or internal metadata.
 */
export async function loadNavbarNotifications(userIds: readonly string[], options: { throwOnError?: boolean; candidateOnly?: boolean } = {}) {
  if (userIds.length === 0) return [];

  try {
    const rows = await prisma.notification.findMany({
      where: { userId: { in: [...userIds] }, ...(options.candidateOnly ? { category: 'recruitment', link: '/candidate' } : {}) },
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        isRead: true,
        createdAt: true,
        category: true,
        link: true,
      },
      orderBy: [{ createdAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: 10,
    });
    return rows.map(row => ({ ...row, category: publicNotificationCategory(row.category), link: safeNotificationLink(row.link) }));
  } catch (error) {
    // Database errors may contain private recipients, credentials or DSNs.
    // The notification bell is optional; do not interrupt dashboard loading.
    console.error('Dashboard notification lookup failed:', safeServerErrorCategory(error));
    if (options.throwOnError) throw error;
    return [];
  }
}
