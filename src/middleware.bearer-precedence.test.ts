// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => m.createClient(...args),
}));

import { middleware } from './middleware';

const request = (authorization?: string, cookie?: string) => new NextRequest(
  'http://localhost/api/private',
  {
    method: 'GET',
    headers: {
      ...(authorization !== undefined ? { authorization } : {}),
      ...(cookie ? { cookie } : {}),
    },
  },
);

describe('Edge API gate credential precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon-key');
    m.createClient.mockReturnValue({ auth: { getUser: m.getUser } });
    m.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid token' },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps cookie-only requests available for downstream role checks', async () => {
    const response = await middleware(request(undefined, 'authjs.session-token=valid-cookie'));
    expect(response.status).toBe(200);
    expect(m.createClient).not.toHaveBeenCalled();
  });

  it('rejects invalid Bearer even with an existing Auth.js cookie', async () => {
    const response = await middleware(request('Bearer expired-token', 'authjs.session-token=valid-cookie'));
    expect(response.status).toBe(401);
    expect(m.getUser).toHaveBeenCalledWith('expired-token');
  });

  it('rejects malformed Authorization with an existing Auth.js cookie', async () => {
    const response = await middleware(request('Basic not-a-bearer', 'authjs.session-token=valid-cookie'));
    expect(response.status).toBe(401);
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.createClient).not.toHaveBeenCalled();
  });

  it('accepts a verified explicit Bearer for downstream role checks', async () => {
    m.getUser.mockResolvedValueOnce({
      data: { user: { id: 'verified-user' } },
      error: null,
    });
    const response = await middleware(request('Bearer verified-token', 'authjs.session-token=other-cookie-user'));
    expect(response.status).toBe(200);
    expect(m.getUser).toHaveBeenCalledWith('verified-token');
  });

  it('rejects explicit Bearer if verification configuration is unavailable, even with a cookie', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const response = await middleware(request('Bearer verified-token', 'authjs.session-token=valid-cookie'));
    expect(response.status).toBe(401);
    expect(m.getUser).not.toHaveBeenCalled();
  });

  it('still denies anonymous requests without either credential', async () => {
    const response = await middleware(request());
    expect(response.status).toBe(401);
    expect(m.createClient).not.toHaveBeenCalled();
  });
});
