// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import { privateAdminJson, privateAdminResponse } from './private-admin-response';

describe('private admin API response headers', () => {
  it('adds authentication and origin variation while preserving existing Vary and CORS', async () => {
    const response = NextResponse.json({ secret: 'not for shared caches' }, {
      headers: { Vary: 'Accept-Encoding, Cookie', 'Access-Control-Allow-Origin': 'https://admin.example.test' },
    });
    const secured = privateAdminResponse(response);
    expect(secured).toBe(response);
    expect(secured.headers.get('Cache-Control')).toBe('private, no-store');
    expect(secured.headers.get('Vary')).toBe('Accept-Encoding, Cookie, Authorization, Origin');
    expect(secured.headers.get('Access-Control-Allow-Origin')).toBe('https://admin.example.test');
  });

  it('keeps status codes and rejects cache reuse for privileged error replies', async () => {
    const response = privateAdminJson({ success: false, error: 'Unavailable' }, { status: 503 });
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Authorization, Cookie, Origin');
    expect(await response.json()).toEqual({ success: false, error: 'Unavailable' });
  });
});
