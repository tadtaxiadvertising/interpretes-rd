import prisma from '@/lib/prisma';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

/**
 * The navbar only needs presentation fields. Do not serialize recipient IDs,
 * internal categories, destination links or future notification metadata.
 */
export async function loadNavbarNotifications(userIds: readonly string[]) {
  if (userIds.length === 0) return [];

  try {
    return await prisma.notification.findMany({
      where: { userId: { in: [...userIds] } },
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        isRead: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  } catch (error) {
    // Database errors may contain private recipients, credentials or DSNs.
    // The notification bell is optional; do not interrupt dashboard loading.
    console.error('Dashboard notification lookup failed:', safeServerErrorCategory(error));
    return [];
  }
}
