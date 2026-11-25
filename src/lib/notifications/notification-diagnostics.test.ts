// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ messages: vi.fn(), notices: vi.fn(), profiles: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: {
  message: { findMany: m.messages }, notification: { findMany: m.notices },
  userProfile: { findMany: m.profiles },
} }));
import { readNotificationDiagnostics } from './notification-diagnostics';
import { notificationEventRow } from './notification-event-row';
import { messageReceivedEvent } from './communication-notification-events';

const now = new Date('2026-11-25T21:00:00Z');
const sender = '123e4567-e89b-42d3-a456-426614174000';
const receiver = '123e4567-e89b-42d3-a456-426614174001';
const old = '123e4567-e89b-42d3-a456-426614174002';
const candidate = '123e4567-e89b-42d3-a456-426614174003';
const message = { id: 'message-1', senderId: sender, receiverId: receiver, createdAt: now, isRead: false };

beforeEach(() => {
  vi.resetAllMocks();
  m.messages.mockResolvedValue([]);
  m.notices.mockResolvedValue([]);
  m.profiles.mockResolvedValue([{ id: sender, role: 'admin' }, { id: receiver, role: 'interpreter' }, { id: candidate, role: 'candidate' }]);
});

describe('notification delivery diagnostics', () => {
  it('reports only aggregates and checks expected notification IDs for authorized recent unread messages', async () => {
    const delivered = notificationEventRow(messageReceivedEvent(receiver, message.id, 'interpreter'));
    m.messages.mockResolvedValueOnce([
      message, { ...message, id: 'message-2' },
      { ...message, id: 'message-3', senderId: old },
      { ...message, id: 'message-4', receiverId: old },
      { ...message, id: 'message-5', isRead: true },
      { ...message, id: 'message-6', createdAt: new Date(now.getTime() - 86400001) },
      { ...message, id: 'message-7', receiverId: candidate },
    ]);
    m.notices.mockResolvedValueOnce([{ userId: receiver, isRead: true }, { userId: old, isRead: false }, { userId: null, isRead: null }])
      .mockResolvedValueOnce([{ id: delivered.id, userId: receiver }]);
    const report = await readNotificationDiagnostics(now);
    expect(report).toMatchObject({
      checkedAt: now.toISOString(), sampleLimit: 200, messagesSampled: 7,
      messagesWithoutDirectSender: 1, messagesWithoutDirectReceiver: 1,
      noticesSampled: 3, noticesUnread: 2, noticesWithoutRecipient: 1,
      noticesWithoutDirectProfile: 1, eligibleUnreadMessages: 2, missingMessageNotices: 1,
      messagesTruncated: false, noticesTruncated: false,
    });
    expect(m.messages.mock.calls[0][0].select).toEqual({ id: true, senderId: true, receiverId: true, createdAt: true, isRead: true });
    expect(m.profiles.mock.calls[0][0].select).toEqual({ id: true, role: true });
    expect(m.notices.mock.calls[1][0]).toEqual({
      where: { id: { in: [delivered.id, notificationEventRow(messageReceivedEvent(receiver, 'message-2', 'interpreter')).id] }, category: 'messaging' },
      select: { id: true, userId: true },
    });
    expect(JSON.stringify(report)).not.toContain(receiver);
    expect(JSON.stringify(report)).not.toContain('message-1');
  });

  it('bounds both samples and marks truncation without including the extra record', async () => {
    m.messages.mockResolvedValueOnce(Array.from({ length: 201 }, (_, i) => ({ ...message, id: String(i), isRead: true })));
    m.notices.mockResolvedValueOnce(Array.from({ length: 201 }, () => ({ userId: receiver, isRead: false })));
    const report = await readNotificationDiagnostics(now);
    expect(report).toMatchObject({ messagesSampled: 200, noticesSampled: 200, noticesUnread: 200, messagesTruncated: true, noticesTruncated: true, missingMessageNotices: 0 });
    expect(m.messages.mock.calls[0][0].take).toBe(201);
    expect(m.notices.mock.calls[0][0].take).toBe(201);
    expect(m.notices).toHaveBeenCalledTimes(1);
  });

  it('avoids unnecessary follow-up queries for empty tables', async () => {
    expect(await readNotificationDiagnostics(now)).toMatchObject({ messagesSampled: 0, noticesSampled: 0, missingMessageNotices: 0 });
    expect(m.profiles).not.toHaveBeenCalled();
    expect(m.notices).toHaveBeenCalledTimes(1);
  });
});
