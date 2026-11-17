import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

describe('middleware liveness probe branding and isolation', () => {
  it('returns Intérpretes RD identity directly without requiring auth or refreshing a session', async () => {
    const request = new NextRequest('https://interpretes.rd.ibusiness.com.do/api/health', {
      headers: {
        Authorization: 'Bearer invalid-token',
        Cookie: 'authjs.session-token=stale; sb-access-token=stale',
        Origin: 'https://untrusted.example',
      },
    });
    const response = await middleware(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'healthy',
      service: 'interpretes-rd',
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('does not extend the liveness bypass to a similarly named private route', async () => {
    const request = new NextRequest('https://interpretes.rd.ibusiness.com.do/api/healthcheck');
    const response = await middleware(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
