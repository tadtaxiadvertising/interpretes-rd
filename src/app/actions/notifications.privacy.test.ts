// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validateAction: vi.fn(),
  notificationCreate: vi.fn(),
  notificationUpdateMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validateAction }));
vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      create: m.notificationCreate,
      updateMany: m.notificationUpdateMany,
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));

import { createNotification, markNotificationAsRead } from './notifications';

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

  it('does not query notifications without a verified linked profile, even if an auth ID exists', async () => {
    m.validateAction.mockResolvedValueOnce({
      user: { userId: '48fb69c9-2ea0-497b-b599-bfd1845ea812', profileId: null, role: 'interpreter' },
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
});
