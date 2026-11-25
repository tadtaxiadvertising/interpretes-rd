// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const m = vi.hoisted(() => ({ guard: vi.fn(), rate: vi.fn(), read: vi.fn(), operational: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: m.guard }));
vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: m.rate, createRateLimitHeaders: () => ({}), RATE_LIMITS: { sessionAccess: {} },
}));
vi.mock('@/lib/notifications/notification-diagnostics', () => ({ readNotificationDiagnostics: m.read }));
vi.mock('@/lib/notifications/operational-notification-diagnostics', () => ({ readOperationalNotificationDiagnostics: m.operational }));
import { GET } from './route';

const request = () => new NextRequest('https://example.test/api/admin/notification-diagnostics');

beforeEach(() => {
  vi.resetAllMocks();
  m.guard.mockResolvedValue(null);
  m.rate.mockReturnValue({ success: true });
  m.operational.mockResolvedValue({ modules: [] });
  m.read.mockResolvedValue({ messagesSampled: 0, missingMessageNotices: 0 });
});

describe('notification diagnostic API', () => {
  it('does not query when the administrator guard denies access', async () => {
    m.guard.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 403 }));
    const req = request();
    const response = await GET(req);
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(m.guard).toHaveBeenCalledWith(req, 'admin');
    expect(m.rate).not.toHaveBeenCalled();
    expect(m.read).not.toHaveBeenCalled();
    expect(m.operational).not.toHaveBeenCalled();
  });
  it('does not query when rate limited', async () => {
    m.rate.mockReturnValueOnce({ success: false });
    expect((await GET(request())).status).toBe(429);
    expect(m.read).not.toHaveBeenCalled();
    expect(m.operational).not.toHaveBeenCalled();
  });
  it('returns a private aggregate report to authorized administrators', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({ success: true, report: { messagesSampled: 0, missingMessageNotices: 0 }, operational: { modules: [] } });
  });
  it('returns unavailable rather than fabricated zero counts on database failure', async () => {
    m.read.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await GET(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ success: false });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
