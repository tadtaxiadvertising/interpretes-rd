// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validateAction: vi.fn(),
  reconcileRecruitmentAdminNotifications: vi.fn(),
  reconcileCandidateNotifications: vi.fn(),
  reconcileInterpreterEvaluations: vi.fn(),
  reconcileCommunications: vi.fn(),
  notificationCreate: vi.fn(),
  notificationCreateMany: vi.fn(),
  notificationCount: vi.fn(),
  notificationFindMany: vi.fn(),
  notificationUpdateMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/notifications/reconcile-communications', () => ({ reconcileCommunications: m.reconcileCommunications }));
vi.mock('@/lib/notifications/reconcile-interpreter-evaluations', () => ({ reconcileInterpreterEvaluations: m.reconcileInterpreterEvaluations }));
vi.mock('@/lib/notifications/reconcile-candidate', () => ({ reconcileCandidateNotifications: m.reconcileCandidateNotifications }));
vi.mock('@/lib/notifications/reconcile-recruitment-admin', () => ({ reconcileRecruitmentAdminNotifications: m.reconcileRecruitmentAdminNotifications }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validateAction }));
vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      create: m.notificationCreate,
      createMany: m.notificationCreateMany,
      count: m.notificationCount,
      findMany: m.notificationFindMany,
      updateMany: m.notificationUpdateMany,
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));

import { createNotification, markNotificationAsRead, getMyNotifications, markAllNotificationsAsRead, getMyNotificationHistory } from './notifications';

const profileId = '123e4567-e89b-42d3-a456-426614174000';
const sensitive = 'postgresql://admin:PRIVATE_PASSWORD@db.internal/notifications';
const data = {
  userId: profileId,
  title: 'Nueva evaluación QA',
  message: 'Evaluación completada.',
  type: 'info' as const,
  link: '/dashboard',
};

describe('notification actions: privacy, ownership and post-commit safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.validateAction.mockResolvedValue({
      user: { profileId, role: 'admin', userId: 'admin-1' },
    });
    m.notificationCreate.mockResolvedValue({ id: 'notification-1' });
    m.notificationCreateMany.mockResolvedValue({ count: 1 });
    m.notificationUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('denies non-admin notification creation before querying Prisma', async () => {
    m.validateAction.mockResolvedValueOnce({ error: 'Forbidden', code: 'UNAUTHORIZED' });
    const response = await createNotification(data);
    expect(response).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(m.notificationCreate).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects invalid recipient UUIDs and non-local URLs', async () => {
    expect(await createNotification({ ...data, userId: 'not-uuid' }))
      .toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(await createNotification({ ...data, link: '//external.invalid' }))
      .toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.notificationCreate).not.toHaveBeenCalled();
  });

  it('saves the notification with an allowlisted payload and refreshes after commit', async () => {
    const result = await createNotification(data);
    expect(result).toEqual({ success: true, data: { id: 'notification-1' } });
    expect(m.notificationCreate).toHaveBeenCalledWith({
      data: { ...data },
      select: { id: true },
    });
    expect(m.revalidatePath).toHaveBeenCalledWith('/');
  });

  it('redacts provider errors on notification creation', async () => {
    m.notificationCreate.mockRejectedValueOnce(new Error(sensitive));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await createNotification(data);
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(log).toHaveBeenCalledWith('Failed to create notification:', 'Error');
      expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/PRIVATE_PASSWORD|db\.internal|postgresql:/);
      expect(m.revalidatePath).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('returns success after creation even when cache refresh throws sensitive details', async () => {
    m.revalidatePath.mockImplementationOnce(() => { throw new Error(sensitive); });
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await createNotification(data);
      expect(result).toEqual({ success: true, data: { id: 'notification-1' } });
      expect(m.notificationCreate).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith('Notification saved but cache refresh failed:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally {
      log.mockRestore();
    }
  });

  it('cannot mark a notification belonging to another profile as read', async () => {
    m.notificationUpdateMany.mockResolvedValueOnce({ count: 0 });
    const result = await markNotificationAsRead('notification-other');
    expect(result).toMatchObject({ success: false, code: 'NOT_FOUND' });
    expect(m.notificationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'notification-other', userId: { in: [profileId] } },
      data: { isRead: true },
    });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it('marks notifications addressed to the authenticated account or linked profile without client-supplied recipient IDs', async () => {
    const authId = '48fb69c9-2ea0-497b-b599-bfd1845ea812';
    m.validateAction.mockResolvedValueOnce({
      user: { userId: authId, profileId, role: 'interpreter' },
    });
    const result = await markNotificationAsRead('notification-account');
    expect(result).toEqual({ success: true });
    expect(m.notificationUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'notification-account',
        userId: { in: [authId, profileId] },
      },
      data: { isRead: true },
    });
  });

  it('does not use untrusted/non-UUID actor IDs as notification recipients', async () => {
    m.validateAction.mockResolvedValueOnce({
      user: { userId: 'legacy-rbac-not-a-uuid', profileId, role: 'interpreter' },
    });
    await markNotificationAsRead('notification-1');
    expect(m.notificationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', userId: { in: [profileId] } },
      data: { isRead: true },
    });
  });

  it('allows an account UUID to mark its own notifications even without a linked profile', async () => {
    const authId = '48fb69c9-2ea0-497b-b599-bfd1845ea812';
    m.validateAction.mockResolvedValueOnce({
      user: { userId: authId, profileId: null, role: 'interpreter' },
    });
    expect(await markNotificationAsRead('notification-1')).toEqual({ success: true });
    expect(m.notificationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'notification-1', userId: { in: [authId] } },
      data: { isRead: true },
    });
  });

  it('denies notification lookup if neither authenticated ID nor profile ID is a UUID', async () => {
    m.validateAction.mockResolvedValueOnce({
      user: { userId: 'legacy-authjs', profileId: null, role: 'interpreter' },
    });
    const response = await markNotificationAsRead('notification-1');
    expect(response).toMatchObject({ success: false, code: 'NOT_FOUND' });
    expect(m.notificationUpdateMany).not.toHaveBeenCalled();
  });

  it('requires a valid profile and notification ID before updating read status', async () => {
    const invalidId = await markNotificationAsRead('');
    expect(invalidId).toMatchObject({ success: false, code: 'NOT_FOUND' });
    m.validateAction.mockResolvedValueOnce({ user: { userId: 'user-1' } });
    const missingProfile = await markNotificationAsRead('notification-1');
    expect(missingProfile).toMatchObject({ success: false, code: 'NOT_FOUND' });
    expect(m.notificationUpdateMany).not.toHaveBeenCalled();
  });

  it('redacts database exceptions on mark-read and retains owner predicate', async () => {
    m.notificationUpdateMany.mockRejectedValueOnce(new Error(sensitive));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await markNotificationAsRead('notification-1');
      expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(log).toHaveBeenCalledWith('Failed to update notification:', 'Error');
      expect(JSON.stringify([result, log.mock.calls])).not.toMatch(/PRIVATE_PASSWORD|db\.internal|postgresql:/);
      expect(m.revalidatePath).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('returns success on mark-read when cache refresh fails after UPDATE', async () => {
    m.revalidatePath.mockImplementationOnce(() => { throw new Error(sensitive); });
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await markNotificationAsRead('notification-1');
      expect(result).toEqual({ success: true });
      expect(m.notificationUpdateMany).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith('Notification saved but cache refresh failed:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally {
      log.mockRestore();
    }
  });
  it('counts all unread notifications only for authenticated recipients', async () => {
    m.notificationFindMany.mockResolvedValueOnce([]);
    m.notificationCount.mockResolvedValueOnce(24);
    expect(await getMyNotifications()).toEqual({ success: true, data: [], unreadCount: 24 });
    expect(m.notificationCount).toHaveBeenCalledWith({
      where: { userId: { in: [profileId] }, OR: [{ isRead: false }, { isRead: null }] },
    });
  });

  it('marks all unread notifications only for the authenticated recipient', async () => {
    expect(await markAllNotificationsAsRead()).toEqual({ success: true });
    expect(m.notificationUpdateMany).toHaveBeenCalledWith({
      where: { userId: { in: [profileId] }, OR: [{ isRead: false }, { isRead: null }] },
      data: { isRead: true },
    });
  });

  it('denies bulk updates and feed reads for unauthorized sessions', async () => {
    m.validateAction.mockResolvedValue({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    expect(await getMyNotifications()).toEqual({ success: false });
    expect(await markAllNotificationsAsRead()).toEqual({ success: false });
    expect(m.notificationCount).not.toHaveBeenCalled();
    expect(m.notificationFindMany).not.toHaveBeenCalled();
    expect(m.notificationUpdateMany).not.toHaveBeenCalled();
  });
  it('paginates only the current account history, filters unread and returns sanitized links', async () => {
    const records = Array.from({ length: 21 }, (_, i) => ({
      id: 'n' + i, title: 'Aviso', message: 'Mensaje', type: 'info', isRead: false,
      createdAt: null, link: i === 0 ? '/dashboard/roleplays?token=secret' : '//evil.invalid',
    }));
    m.notificationFindMany.mockResolvedValueOnce(records);
    const response = await getMyNotificationHistory({ page: 1, unreadOnly: true });
    expect(response).toMatchObject({ success: true, hasMore: true });
    if (response.success) {
      expect(response.data).toHaveLength(20);
      expect(response.data[0].link).toBe('/dashboard/roleplays');
      expect(response.data[1].link).toBeNull();
    }
    expect(m.notificationFindMany).toHaveBeenCalledWith({
      where: { userId: { in: [profileId] }, OR: [{ isRead: false }, { isRead: null }] },
      select: { id: true, title: true, message: true, type: true, isRead: true, createdAt: true, link: true, category: true },
      orderBy: [{ createdAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      skip: 20, take: 21,
    });
  });

  it('rejects invalid pagination and unauthorized history before querying', async () => {
    expect(await getMyNotificationHistory({ page: -1, unreadOnly: true })).toEqual({ success: false });
    expect(await getMyNotificationHistory({ page: 100001, unreadOnly: false })).toEqual({ success: false });
    m.validateAction.mockResolvedValueOnce({ error: 'Unauthorized' });
    expect(await getMyNotificationHistory({ page: 0, unreadOnly: false })).toEqual({ success: false });
    expect(m.notificationFindMany).not.toHaveBeenCalled();
  });
  it('accepts idempotent admin events, without refreshing caches on duplicate delivery', async () => {
    m.notificationCreateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const event = { ...data, eventKey: 'qa.evaluation:42', category: 'qa', link: '/dashboard?token=private' };
    const first = await createNotification(event);
    const retry = await createNotification(event);
    expect(first).toMatchObject({ success: true });
    expect(retry).toEqual(first);
    expect(m.notificationCreateMany).toHaveBeenCalledTimes(2);
    expect(m.notificationCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: profileId, category: 'qa', link: '/dashboard' })],
      skipDuplicates: true,
    });
    expect(m.notificationCreate).not.toHaveBeenCalled();
    expect(m.revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe module destinations before writing notification events', async () => {
    expect(await createNotification({ ...data, eventKey: 'qa.evaluation:42', link: '/api/auth/signout' }))
      .toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(m.notificationCreateMany).not.toHaveBeenCalled();
    expect(m.notificationCreate).not.toHaveBeenCalled();
  });
  it('filters important history by category only within the current recipient', async () => {
    m.notificationFindMany.mockResolvedValueOnce([]);
    expect(await getMyNotificationHistory({ page: 0, unreadOnly: true, category: 'qa', importantOnly: true }))
      .toMatchObject({ success: true, data: [], hasMore: false });
    expect(m.notificationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: { in: [profileId] }, OR: [{ isRead: false }, { isRead: null }], category: 'qa', type: { in: ['warning', 'error'] } },
    }));
  });

  it('rejects unknown category filters without querying the database', async () => {
    expect(await getMyNotificationHistory({ page: 0, unreadOnly: false, category: 'private-internal' })).toEqual({ success: false });
    expect(m.notificationFindMany).not.toHaveBeenCalled();
  });
  it('restricts candidate feed, counter, history and read operations to candidate notices', async () => {
    m.validateAction.mockResolvedValue({ user: { profileId, userId: 'candidate-1', role: 'candidate' } });
    m.notificationFindMany.mockResolvedValue([]);
    m.notificationCount.mockResolvedValue(0);
    expect(await getMyNotifications()).toEqual({ success: true, data: [], unreadCount: 0 });
    await getMyNotificationHistory({ page: 0, unreadOnly: false });
    await markNotificationAsRead('candidate-notice');
    await markAllNotificationsAsRead();
    const scope = { userId: { in: [profileId] }, category: 'recruitment', link: '/candidate' };
    for (const call of m.notificationFindMany.mock.calls) expect(call[0].where).toMatchObject(scope);
    expect(m.notificationFindMany).toHaveBeenCalledTimes(2);
    expect(m.notificationCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining(scope) }));
    expect(m.notificationUpdateMany).toHaveBeenCalledTimes(2);
    for (const call of m.notificationUpdateMany.mock.calls) expect(call[0].where).toMatchObject(scope);
  });

  it('does not let a candidate request operational categories or acknowledge a hidden notice', async () => {
    m.validateAction.mockResolvedValue({ user: { profileId, userId: 'candidate-1', role: 'candidate' } });
    expect(await getMyNotificationHistory({ page: 0, unreadOnly: false, category: 'finance' })).toEqual({ success: true, data: [], hasMore: false });
    expect(m.notificationFindMany).not.toHaveBeenCalled();
    m.notificationUpdateMany.mockResolvedValueOnce({ count: 0 });
    expect(await markNotificationAsRead('old-operational-notice')).toMatchObject({ success: false, code: 'NOT_FOUND' });
    expect(m.notificationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'old-operational-notice', userId: { in: [profileId] }, category: 'recruitment', link: '/candidate' },
      data: { isRead: true },
    });
  });
  it('reconciles only the authenticated administrator profile during feed refresh', async () => {
    m.notificationFindMany.mockResolvedValue([]);
    m.notificationCount.mockResolvedValue(0);
    await getMyNotifications();
    expect(m.reconcileRecruitmentAdminNotifications).toHaveBeenCalledExactlyOnceWith(profileId);
    for (const role of ['candidate', 'interpreter']) {
      m.validateAction.mockResolvedValueOnce({ user: { profileId, userId: 'legacy-user', role } });
      await getMyNotifications();
    }
    expect(m.reconcileRecruitmentAdminNotifications).toHaveBeenCalledTimes(1);
  });
  it('recovers candidate notices only from the authenticated candidate actor', async () => {
    const actor = { profileId, userId: 'legacy-user', role: 'candidate', candidateId: 7, email: 'candidate@example.test' };
    m.validateAction.mockResolvedValueOnce({ user: actor });
    m.notificationFindMany.mockResolvedValue([]);
    m.notificationCount.mockResolvedValue(0);
    expect(await getMyNotifications()).toEqual({ success: true, data: [], unreadCount: 0 });
    expect(m.reconcileCandidateNotifications).toHaveBeenCalledExactlyOnceWith(actor);
    expect(m.reconcileRecruitmentAdminNotifications).not.toHaveBeenCalled();
    m.validateAction.mockResolvedValueOnce({ user: { ...actor, role: 'interpreter' } });
    await getMyNotifications();
    expect(m.reconcileCandidateNotifications).toHaveBeenCalledTimes(1);
  });
  it('recovers evaluation notices only for the authenticated interpreter actor', async () => {
    const actor = { profileId, userId: 'legacy-user', role: 'interpreter', interpreterId: 7, email: 'worker@example.test' };
    m.validateAction.mockResolvedValueOnce({ user: actor });
    m.notificationFindMany.mockResolvedValue([]);
    m.notificationCount.mockResolvedValue(0);
    expect(await getMyNotifications()).toEqual({ success: true, data: [], unreadCount: 0 });
    expect(m.reconcileInterpreterEvaluations).toHaveBeenCalledExactlyOnceWith(actor);
    for (const role of ['candidate', 'admin']) {
      m.validateAction.mockResolvedValueOnce({ user: { ...actor, role } });
      await getMyNotifications();
    }
    expect(m.reconcileInterpreterEvaluations).toHaveBeenCalledTimes(1);
  });
  it('recovers communications only for authenticated operational actors', async () => {
    m.notificationFindMany.mockResolvedValue([]);
    m.notificationCount.mockResolvedValue(0);
    for (const role of ['admin', 'interpreter', 'candidate']) {
      const actor = { profileId, userId: profileId, role, email: 'worker@example.test' };
      m.validateAction.mockResolvedValueOnce({ user: actor });
      await getMyNotifications();
      if (role !== 'candidate') expect(m.reconcileCommunications).toHaveBeenLastCalledWith(actor);
    }
    expect(m.reconcileCommunications).toHaveBeenCalledTimes(2);
  });
});
