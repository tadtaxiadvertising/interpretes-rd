// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  validateAction: vi.fn(), profile: vi.fn(), profiles: vi.fn(),
  findMessage: vi.fn(), messages: vi.fn(), update: vi.fn(), groups: vi.fn(), revalidate: vi.fn(),
}));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validateAction }));
vi.mock('@/lib/prisma', () => ({ default: {
  userProfile: { findUnique: m.profile, findMany: m.profiles },
  message: { findUnique: m.findMessage, findMany: m.messages, updateMany: m.update, groupBy: m.groups },
} }));
vi.mock('@/lib/notifications/publish-notification-event', () => ({ publishNotificationEvent: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
import { getMessages, getChatList, markMessagesAsRead } from './messages';

const profileId = '123e4567-e89b-42d3-a456-426614174000';
const accountId = '48fb69c9-2ea0-497b-b599-bfd1845ea812';
const contactId = '123e4567-e89b-42d3-a456-426614174001';
const messageId = '123e4567-e89b-42d3-a456-426614174002';
const actor = { userId: accountId, profileId, role: 'interpreter' };

beforeEach(() => {
  vi.resetAllMocks();
  m.validateAction.mockResolvedValue({ user: actor });
  m.profile.mockResolvedValue({ id: contactId, role: 'admin' });
  m.messages.mockResolvedValue([]);
  m.profiles.mockResolvedValue([]);
  m.groups.mockResolvedValue([]);
  m.update.mockResolvedValue({ count: 1 });
});

describe('canonical chat identity', () => {
  it('reads both directions of the conversation using the linked profile', async () => {
    expect(await getMessages(contactId)).toMatchObject({ success: true });
    expect(m.messages).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { OR: [{ senderId: profileId, receiverId: contactId }, { senderId: contactId, receiverId: profileId }] },
    }));
  });
  it('accepts a linked-profile conversation cursor and rejects one belonging to an unrelated identity', async () => {
    m.findMessage.mockResolvedValueOnce({ id: messageId, senderId: contactId, receiverId: profileId })
      .mockResolvedValueOnce({ id: messageId, senderId: contactId, receiverId: accountId });
    expect(await getMessages(contactId, messageId)).toMatchObject({ success: true });
    expect(m.messages).toHaveBeenCalledWith(expect.objectContaining({ cursor: { id: messageId }, skip: 1 }));
    expect(await getMessages(contactId, messageId)).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.messages).toHaveBeenCalledTimes(1);
  });
  it('marks only incoming messages from an authorized contact to the linked profile', async () => {
    expect(await markMessagesAsRead(contactId, [messageId])).toMatchObject({ success: true });
    expect(m.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: [messageId] }, senderId: contactId, receiverId: profileId, isRead: false },
      data: { isRead: true },
    });
  });
  it('uses the linked profile for contact activity and unread counts', async () => {
    expect(await getChatList()).toMatchObject({ success: true, data: [] });
    expect(m.messages).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ senderId: profileId }, { receiverId: profileId }] } }));
    expect(m.groups).toHaveBeenCalledWith(expect.objectContaining({ where: { receiverId: profileId, isRead: false } }));
    expect(m.profiles).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: profileId } }) }));
  });
  it('rejects self-conversations using the profile UUID', async () => {
    expect(await getMessages(profileId)).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(m.profile).not.toHaveBeenCalled();
    expect(m.messages).not.toHaveBeenCalled();
  });
  it('fails closed for missing or invalid linked profiles without accessing message records', async () => {
    for (const id of [null, 'invalid']) {
      m.validateAction.mockResolvedValue({ user: { ...actor, profileId: id } });
      expect(await getMessages(contactId)).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
      expect(await getChatList()).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
      expect(await markMessagesAsRead(contactId, [messageId])).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    }
    expect(m.profile).not.toHaveBeenCalled();
    expect(m.messages).not.toHaveBeenCalled();
    expect(m.groups).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
});
