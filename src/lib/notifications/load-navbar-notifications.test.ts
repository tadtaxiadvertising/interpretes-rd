import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { notification: { findMany: m.findMany } },
}));

import { loadNavbarNotifications } from './load-navbar-notifications';

const id = '123e4567-e89b-42d3-a456-426614174000';
const secret = 'postgresql://admin:PRIVATE_PASSWORD@internal-db.invalid/notifications';

describe('minimal notification lookup for the dashboard navbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findMany.mockResolvedValue([
      { id: 'n1', title: 'QA', message: 'Evaluación lista', type: 'info',
        isRead: false, createdAt: new Date('2026-11-17T10:00:00Z') },
    ]);
  });

  it('does not query anything for an empty set of verified profile IDs', async () => {
    expect(await loadNavbarNotifications([])).toEqual([]);
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('fetches exactly the fields used by the bell and limits records', async () => {
    const records = await loadNavbarNotifications([id]);
    expect(records).toHaveLength(1);
    expect(m.findMany).toHaveBeenCalledWith({
      where: { userId: { in: [id] } },
      select: {
        id: true, title: true, message: true, type: true,
        isRead: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const args = JSON.stringify(m.findMany.mock.calls[0][0]);
    for (const key of ['userId: true', 'category', 'link', 'recipientEmail', 'password']) {
      expect(args).not.toContain(key);
    }
  });

  it('does not mutate profile IDs provided by the verified dashboard session', async () => {
    const ids = Object.freeze([id]);
    await loadNavbarNotifications(ids);
    expect(ids).toEqual([id]);
  });

  it('redacts backend errors and keeps the dashboard available', async () => {
    m.findMany.mockRejectedValueOnce(new Error(secret));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await loadNavbarNotifications([id]);
      expect(result).toEqual([]);
      expect(spy).toHaveBeenCalledWith('Dashboard notification lookup failed:', 'Error');
      expect(JSON.stringify([result, spy.mock.calls])).not.toMatch(/PRIVATE_PASSWORD|internal-db\.invalid|postgresql:/);
    } finally {
      spy.mockRestore();
    }
  });

  it('handles non-Error thrown values without exposing them to logs', async () => {
    m.findMany.mockRejectedValueOnce({ password: secret });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await loadNavbarNotifications([id])).toEqual([]);
      expect(spy).toHaveBeenCalledWith('Dashboard notification lookup failed:', 'UnknownError');
      expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    } finally {
      spy.mockRestore();
    }
  });
});
