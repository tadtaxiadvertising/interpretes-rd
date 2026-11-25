// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ transaction: vi.fn(), messages: vi.fn(), profiles: vi.fn(), notices: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: m.transaction } }));
import { repairMessageNotifications } from './repair-message-notifications';
import { notificationEventRow } from './notification-event-row';
import { messageReceivedEvent } from './communication-notification-events';

const now = new Date('2026-11-25T21:00:00Z');
const sender = '123e4567-e89b-42d3-a456-426614174000';
const receiver = '123e4567-e89b-42d3-a456-426614174001';
const candidate = '123e4567-e89b-42d3-a456-426614174002';
const message = { id: 'message-1', senderId: sender, receiverId: receiver, createdAt: now, isRead: false };
const row = (id: string) => notificationEventRow(messageReceivedEvent(receiver, id, 'interpreter'));

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation(async callback => callback({
    message: { findMany: m.messages }, userProfile: { findMany: m.profiles },
    notification: { findMany: m.notices, createMany: m.create },
  }));
  m.messages.mockResolvedValue([]);
  m.profiles.mockResolvedValue([{ id: sender, role: 'admin' }, { id: receiver, role: 'interpreter' }, { id: candidate, role: 'candidate' }]);
  m.notices.mockResolvedValue([]);
  m.create.mockResolvedValue({ count: 1 });
});

describe('message notification repair', () => {
  it('recomputes eligible messages and creates only absent canonical notices', async () => {
    m.messages.mockResolvedValueOnce([
      message, { ...message, id: 'message-2' }, { ...message, id: 'message-3' },
      { ...message, id: 'old', createdAt: new Date(now.getTime() - 86400001) },
      { ...message, id: 'read', isRead: true },
      { ...message, id: 'candidate', receiverId: candidate },
      { ...message, id: 'self', receiverId: sender },
      { ...message, id: 'unknown', senderId: '123e4567-e89b-42d3-a456-426614174003' },
    ]);
    m.notices.mockResolvedValueOnce([row('message-1'), { ...row('message-2'), category: 'system' }]);
    expect(await repairMessageNotifications(now)).toEqual({
      sampled: 8, truncated: false, eligible: 3, created: 1, conflicts: 1, deferred: 0, skipped: 0, repairLimit: 50,
    });
    expect(m.create).toHaveBeenCalledExactlyOnceWith({ data: [row('message-3')], skipDuplicates: true });
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(m.messages.mock.calls[0][0].select).not.toHaveProperty('content');
  });
  it('bounds scans and writes and reports deferred or concurrently inserted rows', async () => {
    m.messages.mockResolvedValueOnce(Array.from({ length: 201 }, (_, i) => ({ ...message, id: 'message-' + i })));
    m.create.mockResolvedValueOnce({ count: 48 });
    expect(await repairMessageNotifications(now)).toMatchObject({
      sampled: 200, truncated: true, eligible: 200, created: 48, deferred: 150, skipped: 2,
    });
    expect(m.messages.mock.calls[0][0].take).toBe(201);
    expect(m.create.mock.calls[0][0].data).toHaveLength(50);
  });
  it('does not overwrite existing notices even when repeated', async () => {
    m.messages.mockResolvedValue([message]);
    m.notices.mockResolvedValueOnce([]).mockResolvedValueOnce([row(message.id)]);
    expect(await repairMessageNotifications(now)).toMatchObject({ created: 1 });
    expect(await repairMessageNotifications(now)).toMatchObject({ created: 0, conflicts: 0 });
    expect(m.create).toHaveBeenCalledTimes(1);
  });
  it('does no profile or notification queries when there are no eligible records', async () => {
    expect(await repairMessageNotifications(now)).toMatchObject({ eligible: 0, created: 0 });
    expect(m.profiles).not.toHaveBeenCalled();
    expect(m.notices).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
  it('propagates a transaction failure instead of reporting a successful repair', async () => {
    m.transaction.mockRejectedValueOnce(new Error('transaction failed'));
    await expect(repairMessageNotifications(now)).rejects.toThrow('transaction failed');
  });
});
