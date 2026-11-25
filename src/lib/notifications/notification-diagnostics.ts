import 'server-only';
import prisma from '@/lib/prisma';
import { canAccessChat } from '@/lib/messaging-access';
import { messageReceivedEvent } from './communication-notification-events';
import { notificationEventRow } from './notification-event-row';

const SAMPLE_LIMIT = 200;
const WINDOW_MS = 86_400_000;

/** No message bodies, user emails or identifiers leave this function. */
export async function readNotificationDiagnostics(now = new Date()) {
  const [messages, notices] = await Promise.all([
    prisma.message.findMany({
      orderBy: [{ createdAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: SAMPLE_LIMIT + 1,
      select: { id: true, senderId: true, receiverId: true, createdAt: true, isRead: true },
    }),
    prisma.notification.findMany({
      orderBy: [{ createdAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: SAMPLE_LIMIT + 1,
      select: { userId: true, isRead: true },
    }),
  ]);
  const messageSample = messages.slice(0, SAMPLE_LIMIT);
  const noticeSample = notices.slice(0, SAMPLE_LIMIT);
  const ids = [...new Set([
    ...messageSample.flatMap(message => [message.senderId, message.receiverId]),
    ...noticeSample.flatMap(notice => notice.userId ? [notice.userId] : []),
  ])];
  const profiles = ids.length ? await prisma.userProfile.findMany({
    where: { id: { in: ids } },
    select: { id: true, role: true },
  }) : [];
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));

  const nowMs = now.getTime();
  const eligible = messageSample.filter(message => {
    const created = message.createdAt?.getTime();
    return message.isRead === false && created !== undefined &&
      created >= nowMs - WINDOW_MS && created <= nowMs &&
      message.senderId !== message.receiverId &&
      canAccessChat(profileById.get(message.receiverId)?.role, profileById.get(message.senderId)?.role);
  });
  const expected = eligible.map(message => notificationEventRow(
    messageReceivedEvent(message.receiverId, message.id, profileById.get(message.receiverId)?.role ?? null),
  ));
  const delivered = expected.length ? await prisma.notification.findMany({
    where: { id: { in: expected.map(row => row.id) }, category: 'messaging' },
    select: { id: true, userId: true },
  }) : [];
  const deliveredById = new Map(delivered.map(notice => [notice.id, notice.userId]));

  return {
    checkedAt: now.toISOString(),
    sampleLimit: SAMPLE_LIMIT,
    messagesSampled: messageSample.length,
    messagesTruncated: messages.length > SAMPLE_LIMIT,
    messagesWithoutDirectSender: messageSample.filter(message => !profileById.has(message.senderId)).length,
    messagesWithoutDirectReceiver: messageSample.filter(message => !profileById.has(message.receiverId)).length,
    noticesSampled: noticeSample.length,
    noticesTruncated: notices.length > SAMPLE_LIMIT,
    noticesUnread: noticeSample.filter(notice => notice.isRead !== true).length,
    noticesWithoutRecipient: noticeSample.filter(notice => !notice.userId).length,
    noticesWithoutDirectProfile: noticeSample.filter(notice => notice.userId && !profileById.has(notice.userId)).length,
    eligibleUnreadMessages: eligible.length,
    missingMessageNotices: expected.filter(row => deliveredById.get(row.id) !== row.userId).length,
  };
}
