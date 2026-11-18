// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

async function cspHeader(customDomain: string, customApi: string) {
  vi.stubEnv('CUSTOM_DOMAIN', customDomain);
  vi.stubEnv('CUSTOM_DOMAIN_API', customApi);
  vi.resetModules();
  const { default: config } = await import('./next.config');
  const entries = await config.headers?.();
  const global = entries?.find(item => item.source === '/:path*');
  const csp = global?.headers.find(item => item.key === 'Content-Security-Policy')?.value;
  expect(csp).toBeTruthy();
  return csp!;
}

describe('CSP custom origins are interpolated and strictly validated', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('adds configured HTTPS origins to connect-src and form-action', async () => {
    const policy = await cspHeader('https://tenant.example', 'https://api.tenant.example:8443');
    const connect = policy.split('; ').find(value => value.startsWith('connect-src '));
    const form = policy.split('; ').find(value => value.startsWith('form-action '));
    expect(connect).toContain('https://tenant.example');
    expect(connect).toContain('https://api.tenant.example:8443');
    expect(form).toContain('https://tenant.example');
    expect(form).toContain('https://api.tenant.example:8443');
    expect(policy).not.toMatch(/\$\{CUSTOM_DOMAIN(?:_API)?\}/);
  });

  it('uses only safe defaults for malformed or injected origins', async () => {
    const policy = await cspHeader(
      "https://malicious.example/;script-src 'unsafe-inline'",
      'https://administrator:password@private.example',
    );
    expect(policy).not.toContain('malicious.example');
    expect(policy).not.toContain('private.example');
    expect(policy).not.toMatch(/\$\{CUSTOM_DOMAIN(?:_API)?\}/);
    expect(policy).toContain('https://interpretes.rd.ibusiness.com.do');
  });

  it.each([
    'http://untrusted.example',
    'javascript:alert(1)',
    'https://untrusted.example/path',
    'https://untrusted.example?secret=1',
    'https://untrusted.example/#fragment',
    'https://untrusted.example\nContent-Security-Policy: default-src *',
  ])('rejects an invalid custom source %s', async value => {
    const policy = await cspHeader(value, '');
    expect(policy).not.toContain('untrusted.example');
    expect(policy).not.toContain('javascript:');
    expect(policy).not.toContain('default-src *');
    expect(policy).not.toMatch(/\$\{CUSTOM_DOMAIN(?:_API)?\}/);
  });
});
