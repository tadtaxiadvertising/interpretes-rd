// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: m.updateSession,
}));

import { middleware } from './middleware';

const request = (method: string, path: string, origin?: string) => new NextRequest(
  `http://localhost${path}`,
  { method, headers: origin ? { origin } : {} },
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('middleware credentialed CORS response boundary', () => {
  it('exposes credentialed CORS only to the configured canonical frontend', async () => {
    vi.stubEnv('FRONTEND_ORIGIN', 'https://interpretes.rd.ibusiness.com.do');
    const allowed = await middleware(request('OPTIONS', '/api/version', 'https://interpretes.rd.ibusiness.com.do'));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://interpretes.rd.ibusiness.com.do');
    expect(allowed.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(allowed.headers.get('Vary')).toContain('Origin');

    const blocked = await middleware(request('OPTIONS', '/api/version', 'https://other.example'));
    expect(blocked.status).toBe(204);
    expect(blocked.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(blocked.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(blocked.headers.get('Vary')).toContain('Origin');
  });

  it('does not authorize the historical fallback when FRONTEND_ORIGIN is missing', async () => {
    vi.stubEnv('FRONTEND_ORIGIN', '');
    const response = await middleware(request('OPTIONS', '/api/version', 'https://freeinterpreters.com'));
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('does not reflect an arbitrary attacker-controlled localhost substring', async () => {
    vi.stubEnv('FRONTEND_ORIGIN', '');
    const response = await middleware(request('OPTIONS', '/api/version', 'https://evil-localhost.example'));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('keeps unauthorized API requests private while allowing the configured origin', async () => {
    vi.stubEnv('FRONTEND_ORIGIN', 'https://interpretes.rd.ibusiness.com.do');
    const response = await middleware(request('GET', '/api/private', 'https://interpretes.rd.ibusiness.com.do'));
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://interpretes.rd.ibusiness.com.do');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(response.headers.get('Vary')).toContain('Origin');
  });

  it('redacts session refresh exceptions instead of logging tokens or URLs', async () => {
    vi.stubEnv('FRONTEND_ORIGIN', 'https://interpretes.rd.ibusiness.com.do');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon-test');
    const error = new Error('postgresql://internal:SECRET_CREDENTIAL@private.db.test/refresh?token=SECRET_CREDENTIAL');
    m.updateSession.mockRejectedValueOnce(error);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = new NextRequest('http://localhost/api/private', {
      method: 'GET',
      headers: {
        origin: 'https://interpretes.rd.ibusiness.com.do',
        cookie: 'sb-access-token=SECRET_CREDENTIAL',
      },
    });
    const response = await middleware(req);
    expect(response.status).toBe(401);
    expect(m.updateSession).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith('[MIDDLEWARE] Supabase session refresh failed:', 'Error');
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/SECRET_CREDENTIAL|private\.db\.test|postgresql:/);
  });

  it('never advertises credentialed CORS for a rejected API origin', async () => {
    vi.stubEnv('FRONTEND_ORIGIN', 'https://interpretes.rd.ibusiness.com.do');
    const response = await middleware(request('GET', '/api/private', 'https://other.example'));
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(response.headers.get('Vary')).toContain('Origin');
  });
});
