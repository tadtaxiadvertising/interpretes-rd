// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const request = (method: string, path: string, origin?: string) => new NextRequest(
  `http://localhost${path}`,
  { method, headers: origin ? { origin } : {} },
);

afterEach(() => {
  vi.unstubAllEnvs();
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

  it('never advertises credentialed CORS for a rejected API origin', async () => {
    vi.stubEnv('FRONTEND_ORIGIN', 'https://interpretes.rd.ibusiness.com.do');
    const response = await middleware(request('GET', '/api/private', 'https://other.example'));
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(response.headers.get('Vary')).toContain('Origin');
  });
});
