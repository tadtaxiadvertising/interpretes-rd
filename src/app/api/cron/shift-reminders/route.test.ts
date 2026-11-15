// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const request = (authorization?: string) => new Request('http://localhost/api/cron/shift-reminders', {
  method: 'POST',
  headers: authorization ? { authorization } : {},
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/cron/shift-reminders', () => {
  it('fails closed without CRON_SECRET even when the caller sends a Bearer token', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const result = await POST(request('Bearer any-value'));
    expect(result.status).toBe(401);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await result.json()).success).toBe(false);
  });

  it('rejects missing and incorrect caller credentials', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request('Bearer wrong-secret'))).status).toBe(401);
    expect((await POST(request('Basic test-cron-secret'))).status).toBe(401);
  });

  it('never reports phantom deliveries or logs interpreter identities without a delivery provider', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await POST(request('Bearer test-cron-secret'));
    expect(result.status).toBe(501);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await result.json()).toEqual({
      success: false,
      code: 'SHIFT_REMINDERS_NOT_CONFIGURED',
      error: 'Shift reminder delivery is not configured.',
      remindersSent: [],
    });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
