// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), repair: vi.fn(), operational: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.auth }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimit: m.limit }));
vi.mock('@/lib/notifications/repair-message-notifications', () => ({ repairMessageNotifications: m.repair }));
vi.mock('@/lib/notifications/operational-notification-diagnostics', () => ({ operationalNotificationModules: ['recruitmentAdmin', 'candidate', 'qa', 'roleplayEvaluation', 'roleplayAssignment', 'audio'] }));
vi.mock('@/lib/notifications/repair-operational-notifications', () => ({ repairOperationalNotifications: m.operational }));
import { repairMissingMessageNotices, repairMissingOperationalNotices } from './notification-repair';
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
  it('requires administrative authorization and explicit confirmation for operational repair', async () => {
    m.auth.mockResolvedValueOnce({ error: 'denied' });
    expect(await repairMissingOperationalNotices('qa', true)).toEqual({ success: false, code: 'UNAUTHORIZED' });
    expect(await repairMissingOperationalNotices('qa', false)).toEqual({ success: false, code: 'CONFIRMATION_REQUIRED' });
    expect(m.operational).not.toHaveBeenCalled();
  });

  it('rejects unknown modules and caller-provided recipient objects', async () => {
    for (const module of ['all', '__proto__', { module: 'qa', userId: 'other' }]) {
      expect(await repairMissingOperationalNotices(module, true)).toEqual({ success: false, code: 'INVALID_MODULE' });
    }
    expect(m.limit).not.toHaveBeenCalled();
    expect(m.operational).not.toHaveBeenCalled();
  });

  it('shares the message repair quota and returns only the selected module result', async () => {
    const result = { ...report, module: 'qa', eligible: 10 };
    m.operational.mockResolvedValueOnce(result);
    expect(await repairMissingOperationalNotices('qa', true)).toEqual({ success: true, report: result });
    expect(m.operational).toHaveBeenCalledExactlyOnceWith('qa');
    expect(m.limit).toHaveBeenCalledWith('verified-admin', { maxRequests: 1, windowMs: 60000, keyPrefix: 'notification-repair' });
    m.limit.mockReturnValueOnce({ success: false });
    expect(await repairMissingMessageNotices(true)).toEqual({ success: false, code: 'RATE_LIMITED' });
    expect(m.repair).not.toHaveBeenCalled();
  });
});
