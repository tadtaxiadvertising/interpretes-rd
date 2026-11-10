'use server';

import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { canAccessChat } from '@/lib/messaging-access';

const db = prisma;

const UserIdSchema = z.string().uuid();
const SendMessageSchema = z.object({
  receiverId: UserIdSchema,
  content: z.string().trim().min(1).max(2_000),
});

async function getAllowedContact(currentUserId: string, otherUserId: string, currentRole: string) {
  if (currentUserId === otherUserId) return null;
  const otherUser = await db.userProfile.findUnique({
    where: { id: otherUserId },
    select: { id: true, role: true },
  });
  if (!otherUser || !canAccessChat(currentRole, otherUser.role)) return null;
  return otherUser;
}

/** Sends a message only to a contact permitted by the server-side role policy. */
export async function sendMessage(receiverId: string, content: string) {
  const auth = await validateAction(['admin', 'interpreter']);
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parsed = SendMessageSchema.safeParse({ receiverId, content });
  if (!parsed.success) {
    return { success: false, error: 'Invalid message data', code: 'VALIDATION_ERROR' };
  }

  try {
    const receiver = await getAllowedContact(auth.user.userId, parsed.data.receiverId, auth.user.role);
    if (!receiver) {
      return { success: false, error: 'Recipient is not available for this conversation', code: 'UNAUTHORIZED' };
    }

    const message = await db.message.create({
      data: {
        senderId: auth.user.userId,
        receiverId: receiver.id,
        content: parsed.data.content,
      },
      select: { id: true, senderId: true, receiverId: true, content: true, isRead: true, createdAt: true },
    });

    revalidatePath('/dashboard/messages');
    revalidatePath('/admin/messages');
    return { success: true, data: message };
  } catch (error) {
    console.error('sendMessage failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Unable to send message', code: 'INTERNAL_ERROR' };
  }
}

/** Returns only the authenticated user's conversation with an authorized contact. */
export async function getMessages(otherUserId: string) {
  const auth = await validateAction(['admin', 'interpreter']);
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parsedId = UserIdSchema.safeParse(otherUserId);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid contact', code: 'VALIDATION_ERROR' };
  }

  try {
    const contact = await getAllowedContact(auth.user.userId, parsedId.data, auth.user.role);
    if (!contact) {
      return { success: false, error: 'Conversation is not available', code: 'UNAUTHORIZED' };
    }

    const messages = await db.message.findMany({
      where: {
        OR: [
          { senderId: auth.user.userId, receiverId: contact.id },
          { senderId: contact.id, receiverId: auth.user.userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, senderId: true, receiverId: true, content: true, isRead: true, createdAt: true },
    });

    return { success: true, data: messages.reverse() };
  } catch (error) {
    console.error('getMessages failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Unable to load messages', code: 'INTERNAL_ERROR' };
  }
}

/** Marks unread messages from an authorized contact to the current user as read. */
export async function markMessagesAsRead(senderId: string) {
  const auth = await validateAction(['admin', 'interpreter']);
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parsedId = UserIdSchema.safeParse(senderId);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid sender', code: 'VALIDATION_ERROR' };
  }

  try {
    const sender = await getAllowedContact(auth.user.userId, parsedId.data, auth.user.role);
    if (!sender) {
      return { success: false, error: 'Conversation is not available', code: 'UNAUTHORIZED' };
    }

    await db.message.updateMany({
      where: {
        senderId: sender.id,
        receiverId: auth.user.userId,
        isRead: false,
      },
      data: { isRead: true },
    });

    revalidatePath('/dashboard/messages');
    revalidatePath('/admin/messages');
    return { success: true };
  } catch (error) {
    console.error('markMessagesAsRead failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Unable to mark messages as read', code: 'INTERNAL_ERROR' };
  }
}

/** Builds the contact list from bounded recent activity, avoiding per-contact queries. */
export async function getChatList() {
  const auth = await validateAction(['admin', 'interpreter']);
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const isAdmin = auth.user.role === 'admin';
    const usersWithProfiles = await db.userProfile.findMany({
      where: isAdmin
        ? { id: { not: auth.user.userId }, role: { in: ['admin', 'ADMIN', 'interpreter', 'INTERPRETER'] } }
        : { role: { in: ['admin', 'ADMIN'] } },
      select: { id: true, displayName: true, role: true, email: true },
      orderBy: { displayName: 'asc' },
      take: 500,
    });

    const [recentMessages, unreadGroups] = await Promise.all([
      db.message.findMany({
        where: {
          OR: [
            { senderId: auth.user.userId },
            { receiverId: auth.user.userId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 1_000,
        select: { senderId: true, receiverId: true, content: true, createdAt: true },
      }),
      db.message.groupBy({
        by: ['senderId'],
        where: { receiverId: auth.user.userId, isRead: false },
        _count: { _all: true },
      }),
    ]);

    const lastMessageByContact = new Map<string, {
      content: string;
      createdAt: Date | null;
      senderId: string;
    }>();
    for (const message of recentMessages) {
      const contactId = message.senderId === auth.user.userId ? message.receiverId : message.senderId;
      if (!lastMessageByContact.has(contactId)) {
        lastMessageByContact.set(contactId, {
          content: message.content,
          createdAt: message.createdAt,
          senderId: message.senderId,
        });
      }
    }

    const unreadCountBySender = new Map(unreadGroups.map((group) => [group.senderId, group._count._all]));
    const chatList = usersWithProfiles.map((user) => ({
      id: user.id,
      name: user.displayName || user.email.split('@')[0],
      email: user.email,
      role: user.role,
      lastMessage: lastMessageByContact.get(user.id) ?? null,
      unreadCount: unreadCountBySender.get(user.id) ?? 0,
    }));

    chatList.sort((a, b) => {
      if (!a.lastMessage) return 1;
      if (!b.lastMessage) return -1;
      return (b.lastMessage.createdAt?.getTime() ?? 0) - (a.lastMessage.createdAt?.getTime() ?? 0);
    });

    return { success: true, data: chatList };
  } catch (error) {
    console.error('getChatList failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Unable to load chat contacts', code: 'INTERNAL_ERROR' };
  }
}
