// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), repair: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.auth }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimit: m.limit }));
vi.mock('@/lib/notifications/repair-message-notifications', () => ({ repairMessageNotifications: m.repair }));
import { repairMissingMessageNotices } from './notification-repair';
const report = { sampled: 10, created: 2, conflicts: 0, deferred: 0, skipped: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { userId: 'verified-admin' } });
  m.limit.mockReturnValue({ success: true });
  m.repair.mockResolvedValue(report);
});

describe('administrative notification repair', () => {
  it('rejects unauthorized actors before any repair', async () => {
    m.auth.mockResolvedValueOnce({ error: 'denied' });
    expect(await repairMissingMessageNotices(true)).toEqual({ success: false, code: 'UNAUTHORIZED' });
    expect(m.auth).toHaveBeenCalledWith('admin');
    expect(m.limit).not.toHaveBeenCalled();
    expect(m.repair).not.toHaveBeenCalled();
  });
  it('requires explicit boolean confirmation', async () => {
    for (const value of [false, undefined, 'true', { confirmed: true }]) {
      expect(await repairMissingMessageNotices(value)).toEqual({ success: false, code: 'CONFIRMATION_REQUIRED' });
    }
    expect(m.repair).not.toHaveBeenCalled();
  });
  it('limits repair by authenticated account, not a client identity', async () => {
    m.limit.mockReturnValueOnce({ success: false });
    expect(await repairMissingMessageNotices(true)).toEqual({ success: false, code: 'RATE_LIMITED' });
    expect(m.limit).toHaveBeenCalledWith('verified-admin', { maxRequests: 1, windowMs: 60000, keyPrefix: 'notification-repair' });
    expect(m.repair).not.toHaveBeenCalled();
  });
  it('returns the aggregate committed result without caller-selected recipients', async () => {
    expect(await repairMissingMessageNotices(true)).toEqual({ success: true, report });
    expect(m.repair).toHaveBeenCalledExactlyOnceWith();
  });
  it('redacts failures and does not invent success counts', async () => {
    m.repair.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await repairMissingMessageNotices(true)).toEqual({ success: false, code: 'UNAVAILABLE' });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
