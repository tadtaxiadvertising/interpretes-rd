'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { validateAction } from '@/lib/auth/actions';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { authorizedNotificationRecipientIds } from '@/lib/notifications/authorized-recipient-ids';

const db = prisma;

const CreateNotificationSchema = z.object({
  userId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(4000),
  type: z.enum(['info', 'success', 'warning', 'error']).optional(),
  // Notifications may navigate only within this application.
  link: z.string().trim().max(500).regex(/^\/(?!\/)/).optional(),
});

const NotificationIdSchema = z.string().min(1).max(128);

// Refreshing Next.js cache happens after the database write commits.
// A refresh failure must never be reported as a failed create/mark-read,
// otherwise users may retry and generate duplicate notifications.
function refreshNotificationCache() {
  try {
    revalidatePath('/');
  } catch (error) {
    console.warn('Notification saved but cache refresh failed:', safeServerErrorCategory(error));
  }
}

/**
 * Create notifications as an administrative operation.
 *
 * The recipient is intentionally accepted only from a validated admin
 * workflow (for example QA/Roleplay evaluation), never from an interpreter
 * invoking this Server Action directly.
 */
export async function createNotification(input: unknown) {
  const auth = await validateAction('admin');
  if ('error' in auth) {
    return { success: false, error: auth.error, code: auth.code };
  }

  const parsed = CreateNotificationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'Invalid notification data', code: 'VALIDATION_ERROR' };
  }

  try {
    const notification = await db.notification.create({
      data: {
        userId: parsed.data.userId,
        title: parsed.data.title,
        message: parsed.data.message,
        type: parsed.data.type ?? 'info',
        link: parsed.data.link,
      },
      select: { id: true },
    });

    refreshNotificationCache();
    return { success: true, data: notification };
  } catch (error) {
    console.error('Failed to create notification:', safeServerErrorCategory(error));
    return { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' };
  }
}

/**
 * A user may only mark a notification addressed to their own profile as read.
 * The ownership predicate is part of the UPDATE itself to avoid an IDOR race.
 */
export async function markNotificationAsRead(id: string) {
  const auth = await validateAction();
  if ('error' in auth) {
    return { success: false, error: auth.error, code: auth.code };
  }

  const parsedId = NotificationIdSchema.safeParse(id);
  // Only accept linked profile identity from a trusted server-side actor.
  // This preserves existing fail-closed behavior if there is no profile.
  if (!parsedId.success || !auth.user.profileId) {
    return { success: false, error: 'Notification not found', code: 'NOT_FOUND' };
  }
  const recipientIds = authorizedNotificationRecipientIds(auth.user.userId, auth.user.profileId);
  if (recipientIds.length === 0) {
    return { success: false, error: 'Notification not found', code: 'NOT_FOUND' };
  }

  try {
    const updated = await db.notification.updateMany({
      where: {
        id: parsedId.data,
        // The dashboard lists notifications addressed to either linked ID.
        // Never permit a recipient ID passed by the caller.
        userId: { in: recipientIds },
      },
      data: { isRead: true },
    });

    if (updated.count !== 1) {
      return { success: false, error: 'Notification not found', code: 'NOT_FOUND' };
    }

    refreshNotificationCache();
    return { success: true };
  } catch (error) {
    console.error('Failed to update notification:', safeServerErrorCategory(error));
    return { success: false, error: 'Failed to update notification', code: 'INTERNAL_ERROR' };
  }
}
