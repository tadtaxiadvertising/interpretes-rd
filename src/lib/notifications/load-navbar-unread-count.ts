import 'server-only';
import prisma from '@/lib/prisma';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

/** Null is unknown; never treat a failed count as zero. */
export async function loadNavbarUnreadCount(userIds: readonly string[], candidateOnly = false): Promise<number | null> {
  if (!userIds.length) return 0;
  try {
    return await prisma.notification.count({
      where: {
        userId: { in: [...userIds] },
        ...(candidateOnly ? { category: 'recruitment', link: '/candidate' } : {}),
        OR: [{ isRead: false }, { isRead: null }],
      },
    });
  } catch (error) {
    console.warn('Dashboard notification count failed:', safeServerErrorCategory(error));
    return null;
  }
}
