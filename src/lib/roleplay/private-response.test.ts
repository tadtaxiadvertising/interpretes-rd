import { describe, expect, it } from 'vitest';
import { privateRoleplayResponse } from './private-response';

describe('private roleplay invitation response', () => {
  it('never caches successful and error responses while preserving status', async () => {
    for (const status of [200, 400, 401, 403, 404, 409, 429, 500]) {
      const response = privateRoleplayResponse(
        { success: false, error: 'test' },
        { status },
      );
      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Vary')).toBe('Cookie, Authorization');
      expect((await response.json()).error).toBe('test');
    }
  });

  it('preserves rate-limit headers and any existing Vary dimensions', () => {
    const response = privateRoleplayResponse({ success: false }, {
      status: 429,
      headers: {
        'Retry-After': '40',
        'Vary': 'Accept-Encoding',
        'Cache-Control': 'public, max-age=3600',
      },
    });
    expect(response.headers.get('Retry-After')).toBe('40');
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Cookie, Authorization');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('does not duplicate an already present Cookie Vary dimension', () => {
    const response = privateRoleplayResponse({ ok: true }, {
      headers: { Vary: 'Accept-Encoding, cookie' },
    });
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, cookie, Authorization');
  });
  it('does not duplicate Authorization Vary irrespective of casing', () => {
    const response = privateRoleplayResponse({ ok: true }, {
      headers: { Vary: 'Origin, AUTHORIZATION, cookie' },
    });
    expect(response.headers.get('Vary')).toBe('Origin, AUTHORIZATION, cookie');
  });
  it('preserves wildcard Vary semantics', () => {
    const response = privateRoleplayResponse({ ok: true }, {
      headers: { Vary: '*' },
    });
    expect(response.headers.get('Vary')).toBe('*');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
