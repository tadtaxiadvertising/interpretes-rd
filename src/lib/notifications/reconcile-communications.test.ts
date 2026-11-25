// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentActor } from '@/lib/auth/current-actor';
const m = vi.hoisted(() => ({ profile: vi.fn(), senders: vi.fn(), sessions: vi.fn(), messages: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: {
  userProfile: { findUnique: m.profile, findMany: m.senders },
  roleplaySession: { findMany: m.sessions },
  message: { findMany: m.messages },
  notification: { createMany: m.insert },
} }));
import { reconcileCommunications } from './reconcile-communications';
import { messageReceivedEvent, roleplayAssignmentEvent } from './communication-notification-events';
import { notificationEventRow } from './notification-event-row';

const now = Date.parse('2026-11-25T21:00:00Z');
const uid = (id: number) => '123e4567-e89b-42d3-a456-' + String(id).padStart(12, '0');
const actor = (id: number, role: CurrentActor['role'] = 'interpreter'): CurrentActor => ({
  provider: 'supabase', userId: uid(id), profileId: uid(id), role,
  interpreterId: role === 'interpreter' ? 7 : null, candidateId: null, email: 'worker@example.test',
});
const recent = { gte: new Date(now - 86400000), lte: new Date(now) };

beforeEach(() => {
  vi.resetAllMocks();
  m.profile.mockImplementation(async ({ where }) => ({ id: where.id, email: 'worker@example.test', role: 'interpreter', interpreterId: 7 }));
  m.sessions.mockResolvedValue([]);
  m.messages.mockResolvedValue([]);
  m.senders.mockResolvedValue([]);
  m.insert.mockResolvedValue({ count: 1 });
});

describe('communication notification reconciliation', () => {
  it('recovers only published available assignments and authorized unread messages with original IDs', async () => {
    const a = actor(1);
    m.sessions.mockResolvedValueOnce([{ id: 'session-1' }]);
    m.messages.mockResolvedValueOnce([
      { id: 'message-1', senderId: uid(90) },
      { id: 'message-2', senderId: uid(91) },
      { id: 'message-3', senderId: uid(92) },
      { id: 'message-4', senderId: a.userId },
    ]);
    m.senders.mockResolvedValueOnce([{ id: uid(90), role: 'ADMIN' }, { id: uid(91), role: 'candidate' }, { id: uid(92), role: 'interpreter' }]);
    await reconcileCommunications(a, now);
    expect(m.sessions).toHaveBeenCalledExactlyOnceWith({
      where: { interpreterId: 7, recruitmentCandidateId: null, status: 'INVITED', updatedAt: recent, scenarios: { some: {}, none: { baseAudioUrl: '' } } },
      select: { id: true }, orderBy: { id: 'asc' }, take: 50,
    });
    expect(m.messages).toHaveBeenCalledExactlyOnceWith({
      where: { receiverId: a.userId, senderId: { not: a.userId }, isRead: false, createdAt: recent },
      select: { id: true, senderId: true }, orderBy: { id: 'asc' }, take: 50,
    });
    expect(m.insert.mock.calls).toEqual([
      [{ data: [notificationEventRow(roleplayAssignmentEvent(a.userId, 'session-1'))], skipDuplicates: true }],
      [{ data: [notificationEventRow(messageReceivedEvent(a.userId, 'message-1', 'interpreter'))], skipDuplicates: true }],
    ]);
  });

  it('recovers admin messages with the admin destination but never interpreter assignments', async () => {
    const a = actor(2, 'admin');
    m.profile.mockResolvedValueOnce({ id: a.userId, role: 'admin', email: a.email, interpreterId: null });
    m.messages.mockResolvedValueOnce([{ id: 'message-1', senderId: uid(90) }]);
    m.senders.mockResolvedValueOnce([{ id: uid(90), role: 'interpreter' }]);
    await reconcileCommunications(a, now);
    expect(m.sessions).not.toHaveBeenCalled();
    expect(m.insert).toHaveBeenCalledExactlyOnceWith({ data: [notificationEventRow(messageReceivedEvent(a.userId, 'message-1', 'admin'))], skipDuplicates: true });
  });

  it('rejects candidate, invalid profile and mismatched persisted identity', async () => {
    await reconcileCommunications(actor(3, 'candidate'), now);
    await reconcileCommunications({ ...actor(3), profileId: null }, now);
    expect(m.profile).not.toHaveBeenCalled();
    m.profile.mockResolvedValueOnce({ id: uid(4), role: 'interpreter', interpreterId: 7, email: 'other@example.test' });
    await reconcileCommunications(actor(4), now);
    expect(m.sessions).not.toHaveBeenCalled();
    expect(m.messages).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
  });

  it('recovers messages at the linked profile even when the authenticated account ID differs', async () => {
    const a = actor(5);
    m.messages.mockResolvedValueOnce([{ id: 'message-1', senderId: uid(90) }]);
    m.senders.mockResolvedValueOnce([{ id: uid(90), role: 'admin' }]);
    await reconcileCommunications({ ...a, provider: 'authjs', userId: 'legacy-account' }, now);
    expect(m.sessions).toHaveBeenCalledTimes(1);
    expect(m.messages).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ receiverId: a.profileId }) }));
    expect(m.insert).toHaveBeenCalledExactlyOnceWith({ data: [notificationEventRow(messageReceivedEvent(a.profileId!, 'message-1', 'interpreter'))], skipDuplicates: true });
  });

  it('throttles retries and advances bounded independent cursors', async () => {
    const a = actor(6);
    m.sessions.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ id: 'session-' + i })));
    m.messages.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ id: 'message-' + i, senderId: uid(90) })));
    await reconcileCommunications(a, now);
    await reconcileCommunications(a, now + 1000);
    expect(m.sessions).toHaveBeenCalledTimes(1);
    expect(m.messages).toHaveBeenCalledTimes(1);
    await reconcileCommunications(a, now + 300000);
    expect(m.sessions.mock.calls[1][0].where.id).toEqual({ gt: 'session-49' });
    expect(m.messages.mock.calls[1][0].where.id).toEqual({ gt: 'message-49' });
    await reconcileCommunications(a, now + 600000);
    expect(m.sessions.mock.calls[2][0].where.id).toBeUndefined();
    expect(m.messages.mock.calls[2][0].where.id).toBeUndefined();
  });

  it('isolates failed assignment writes from message recovery and retries the failed page', async () => {
    const a = actor(7);
    m.sessions.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ id: 'session-' + i })));
    m.messages.mockResolvedValueOnce([{ id: 'message-1', senderId: uid(90) }]);
    m.senders.mockResolvedValueOnce([{ id: uid(90), role: 'admin' }]);
    m.insert.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await reconcileCommunications(a, now);
      expect(m.insert).toHaveBeenCalledTimes(2);
      expect(m.insert.mock.calls[1][0].data).toEqual([notificationEventRow(messageReceivedEvent(a.userId, 'message-1', 'interpreter'))]);
      await reconcileCommunications(a, now + 300000);
      expect(m.sessions.mock.calls[1][0].where.id).toBeUndefined();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
