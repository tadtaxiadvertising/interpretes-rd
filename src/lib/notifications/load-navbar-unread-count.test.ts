import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { notification: { count: m.count } } }));
import { loadNavbarUnreadCount } from './load-navbar-unread-count';
beforeEach(() => { vi.resetAllMocks(); m.count.mockResolvedValue(42); });
describe('initial unread total', () => {
  it('counts all unread and legacy null-read rows only for authorized recipients', async () => {
    expect(await loadNavbarUnreadCount(['profile-a', 'account-a'])).toBe(42);
    expect(m.count).toHaveBeenCalledExactlyOnceWith({ where: { userId: { in: ['profile-a', 'account-a'] }, OR: [{ isRead: false }, { isRead: null }] } });
  });
  it('restricts candidate totals to their recruitment notices', async () => {
    await loadNavbarUnreadCount(['candidate-a'], true);
    expect(m.count).toHaveBeenCalledExactlyOnceWith({ where: { userId: { in: ['candidate-a'] }, category: 'recruitment', link: '/candidate', OR: [{ isRead: false }, { isRead: null }] } });
  });
  it('skips empty scopes and never returns false zero on database failure', async () => {
    expect(await loadNavbarUnreadCount([])).toBe(0);
    expect(m.count).not.toHaveBeenCalled();
    m.count.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await loadNavbarUnreadCount(['profile-a'])).toBeNull();
      expect(JSON.stringify(spy.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { spy.mockRestore(); }
  });
});
