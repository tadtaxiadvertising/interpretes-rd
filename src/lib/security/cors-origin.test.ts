import { describe, expect, it } from 'vitest';
import { addCorsVary, trustedCorsOrigin } from './cors-origin';

describe('credentialed CORS origin policy', () => {
  const canonical = 'https://interpretes.rd.ibusiness.com.do';

  it('allows only the configured HTTPS origin in production', () => {
    expect(trustedCorsOrigin(canonical, canonical, true)).toBe(canonical);
    expect(trustedCorsOrigin(canonical, `${canonical}/`, true)).toBe(canonical);
    expect(trustedCorsOrigin('https://other.example', canonical, true)).toBeNull();
    expect(trustedCorsOrigin('https://freeinterpreters.com', undefined, true)).toBeNull();
    expect(trustedCorsOrigin(canonical, undefined, true)).toBeNull();
  });

  it.each([
    ['legacy fallback', 'https://freeinterpreters.com'],
    ['hostname substring', 'https://evil-localhost.example'],
    ['path confusion', 'https://interpretes.rd.ibusiness.com.do/a'],
    ['credentials', 'https://user:secret@interpretes.rd.ibusiness.com.do'],
    ['query', 'https://interpretes.rd.ibusiness.com.do/?token=x'],
    ['fragment', 'https://interpretes.rd.ibusiness.com.do/#test'],
    ['newline', 'https://interpretes.rd.ibusiness.com.do/\n'],
    ['literal null', 'null'],
  ])('rejects %s as a production browser origin', (_reason, origin) => {
    expect(trustedCorsOrigin(origin, canonical, true)).toBeNull();
  });

  it('allows exact development loopback origins, but rejects attacker hostname substrings', () => {
    expect(trustedCorsOrigin('http://localhost:3000', undefined, false)).toBe('http://localhost:3000');
    expect(trustedCorsOrigin('http://127.0.0.1:3000', undefined, false)).toBe('http://127.0.0.1:3000');
    expect(trustedCorsOrigin('http://[::1]:3000', undefined, false)).toBe('http://[::1]:3000');
    expect(trustedCorsOrigin('https://customer-localhost.example', undefined, false)).toBeNull();
    expect(trustedCorsOrigin('http://evil-localhost.example', undefined, false)).toBeNull();
    expect(trustedCorsOrigin('http://localhost:3000', canonical, true)).toBeNull();
  });

  it('preserves existing Vary values without duplicating Origin', () => {
    const headers = new Headers({ Vary: 'Cookie, Authorization' });
    addCorsVary(headers);
    addCorsVary(headers);
    expect(headers.get('Vary')).toBe('Cookie, Authorization, Origin');
  });
});
