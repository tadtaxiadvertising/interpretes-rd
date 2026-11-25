// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ validateAction: vi.fn(), findUnique: vi.fn(), create: vi.fn(), publish: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validateAction }));
vi.mock('@/lib/prisma', () => ({ default: { userProfile: { findUnique: m.findUnique }, message: { create: m.create } } }));
vi.mock('@/lib/notifications/publish-notification-event', () => ({ publishNotificationEvent: m.publish }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));

import { sendMessage } from './messages';
const senderId = '48fb69c9-2ea0-497b-b599-bfd1845ea812';
const receiverId = '123e4567-e89b-42d3-a456-426614174000';
const message = { id: 'message-1', senderId, receiverId, content: 'Private conversation', isRead: false, createdAt: null };

beforeEach(() => {
  vi.resetAllMocks();
  m.validateAction.mockResolvedValue({ user: { userId: 'authjs-account', profileId: senderId, role: 'admin' } });
  m.findUnique.mockResolvedValue({ id: receiverId, role: 'interpreter' });
  m.create.mockResolvedValue(message);
  m.publish.mockResolvedValue({ id: 'notification-1', created: true });
});

describe('message notification delivery', () => {
  it('notifies the verified recipient without copying the private conversation', async () => {
    expect(await sendMessage(receiverId, message.content)).toEqual({ success: true, data: message });
    expect(m.publish).toHaveBeenCalledWith({
      userId: receiverId, eventKey: 'messaging.message:message-1', category: 'messaging', type: 'info',
      title: 'Nuevo mensaje', message: 'Tienes un nuevo mensaje en tu bandeja de entrada.', link: '/dashboard/messages',
    });
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: { senderId, receiverId, content: message.content } }));
    expect(m.create.mock.invocationCallOrder[0]).toBeLessThan(m.publish.mock.invocationCallOrder[0]);
  });

  it('routes an interpreter message to the administrative inbox', async () => {
    m.validateAction.mockResolvedValue({ user: { userId: 'authjs-account', profileId: senderId, role: 'interpreter' } });
    m.findUnique.mockResolvedValue({ id: receiverId, role: 'ADMIN' });
    expect(await sendMessage(receiverId, message.content)).toMatchObject({ success: true });
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ link: '/admin/messages' }));
  });

  it('rejects an unlinked account without reading contacts or writing messages', async () => {
    m.validateAction.mockResolvedValue({ user: { userId: senderId, profileId: null, role: 'admin' } });
    expect(await sendMessage(receiverId, message.content)).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(m.findUnique).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });

  it('never publishes for an unauthorized conversation', async () => {
    m.findUnique.mockResolvedValue(null);
    expect(await sendMessage(receiverId, message.content)).toMatchObject({ success: false });
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it('keeps committed messages successful when delivery or cache refresh fails', async () => {
    m.publish.mockRejectedValue(new Error('PRIVATE_PASSWORD'));
    m.revalidatePath.mockImplementation(() => { throw new Error('PRIVATE_PASSWORD'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await sendMessage(receiverId, message.content)).toEqual({ success: true, data: message });
      expect(m.create).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
