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
export async function getMessages(otherUserId: string, beforeMessageId?: string) {
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

    let cursor: { id: string } | undefined;
    if (beforeMessageId) {
      const parsedCursor = UserIdSchema.safeParse(beforeMessageId);
      if (!parsedCursor.success) {
        return { success: false, error: 'Invalid message cursor', code: 'VALIDATION_ERROR' };
      }
      const cursorMessage = await db.message.findUnique({
        where: { id: parsedCursor.data },
        select: { id: true, senderId: true, receiverId: true },
      });
      const belongsToConversation = cursorMessage && (
        (cursorMessage.senderId === auth.user.userId && cursorMessage.receiverId === contact.id) ||
        (cursorMessage.senderId === contact.id && cursorMessage.receiverId === auth.user.userId)
      );
      if (!belongsToConversation) {
        return { success: false, error: 'Message cursor is not part of this conversation', code: 'VALIDATION_ERROR' };
      }
      cursor = { id: cursorMessage.id };
    }

    const messages = await db.message.findMany({
      where: {
        OR: [
          { senderId: auth.user.userId, receiverId: contact.id },
          { senderId: contact.id, receiverId: auth.user.userId },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
      ...(cursor ? { cursor, skip: 1 } : {}),
      select: { id: true, senderId: true, receiverId: true, content: true, isRead: true, createdAt: true },
    });

    const hasMore = messages.length > 100;
    return { success: true, data: messages.slice(0, 100).reverse(), hasMore };
  } catch (error) {
    console.error('getMessages failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Unable to load messages', code: 'INTERNAL_ERROR' };
  }
}

/** Marks unread messages from an authorized contact to the current user as read. */
export async function markMessagesAsRead(senderId: string, messageIds: string[]) {
  const auth = await validateAction(['admin', 'interpreter']);
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parsedSender = UserIdSchema.safeParse(senderId);
  const parsedIds = z.array(UserIdSchema).min(1).max(100).safeParse(messageIds);
  if (!parsedSender.success || !parsedIds.success) {
    return { success: false, error: 'Invalid read receipt data', code: 'VALIDATION_ERROR' };
  }

  try {
    const sender = await getAllowedContact(auth.user.userId, parsedSender.data, auth.user.role);
    if (!sender) {
      return { success: false, error: 'Conversation is not available', code: 'UNAUTHORIZED' };
    }

    await db.message.updateMany({
      where: {
        id: { in: parsedIds.data },
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
export async function getChatList(searchQuery = '') {
  const auth = await validateAction(['admin', 'interpreter']);
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parsedSearch = z.string().trim().max(100).safeParse(searchQuery);
  if (!parsedSearch.success) {
    return { success: false, error: 'Invalid contact search', code: 'VALIDATION_ERROR' };
  }

  try {
    const allowedRoles = auth.user.role === 'admin'
      ? ['admin', 'ADMIN', 'interpreter', 'INTERPRETER']
      : ['admin', 'ADMIN'];

    const [recentMessages, unreadGroups, directoryUsers] = await Promise.all([
      db.message.findMany({
        where: {
          OR: [
            { senderId: auth.user.userId },
            { receiverId: auth.user.userId },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2_000,
        select: { senderId: true, receiverId: true, content: true, createdAt: true },
      }),
      db.message.groupBy({
        by: ['senderId'],
        where: { receiverId: auth.user.userId, isRead: false },
        _count: { _all: true },
      }),
      db.userProfile.findMany({
        where: {
          id: { not: auth.user.userId },
          role: { in: allowedRoles },
          ...(parsedSearch.data ? {
            OR: [
              { displayName: { contains: parsedSearch.data, mode: 'insensitive' } },
              { email: { contains: parsedSearch.data, mode: 'insensitive' } },
            ],
          } : {}),
        },
        select: { id: true, displayName: true, role: true, email: true },
        orderBy: { displayName: 'asc' },
        take: 100,
      }),
    ]);

    const activeContactIds = Array.from(new Set([
      ...recentMessages.map((message) =>
        message.senderId === auth.user.userId ? message.receiverId : message.senderId,
      ),
      ...unreadGroups.map((group) => group.senderId),
    ])).filter((id) => id !== auth.user.userId);

    const activeProfiles = activeContactIds.length
      ? await db.userProfile.findMany({
          where: { id: { in: activeContactIds }, role: { in: allowedRoles } },
          select: { id: true, displayName: true, role: true, email: true },
        })
      : [];

    const profileById = new Map<string, typeof directoryUsers[number]>();
    for (const profile of [...activeProfiles, ...directoryUsers]) {
      profileById.set(profile.id, profile);
    }

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
    const chatList = Array.from(profileById.values())
      .filter((user) => !parsedSearch.data || (
        user.displayName?.toLowerCase().includes(parsedSearch.data.toLowerCase()) ||
        user.email.toLowerCase().includes(parsedSearch.data.toLowerCase())
      ))
      .map((user) => ({
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
