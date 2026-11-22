// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_ORIGIN = 'https://interpretes.rd.ibusiness.com.do';

async function configuredCorsHeader(origin: string, nodeEnv: 'test' | 'production' = 'production') {
  vi.stubEnv('FRONTEND_ORIGIN', origin);
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  const { default: config } = await import('../../../next.config');
  const rules = await config.headers?.();
  const api = rules?.find(rule => rule.source === '/api/:path*');
  expect(api).toBeDefined();
  return api!.headers.find(header => header.key === 'Access-Control-Allow-Origin')?.value;
}

describe('Next.js credentialed API CORS origin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('normalizes a valid HTTPS origin without reflecting trailing slashes', async () => {
    expect(await configuredCorsHeader('https://frontend.example:8443/')).toBe('https://frontend.example:8443');
    expect(await configuredCorsHeader('https://frontend.example')).toBe('https://frontend.example');
  });

  it.each([
    '',
    'http://untrusted.example',
    'javascript:alert(1)',
    'https://attacker.example/path',
    'https://attacker.example?token=SYNTHETIC_SECRET',
    'https://attacker.example/#fragment',
    'https://user:pass@attacker.example',
    'https://attacker.example\nAccess-Control-Allow-Origin: *',
    'https://attacker.example\t',
    'https://attacker.example extra',
  ])('fails closed on untrusted FRONTEND_ORIGIN %s', async value => {
    const responseOrigin = await configuredCorsHeader(value);
    expect(responseOrigin).toBe(DEFAULT_ORIGIN);
    expect(responseOrigin).not.toContain('attacker.example');
    expect(responseOrigin).not.toContain('SYNTHETIC_SECRET');
  });

  it('allows explicitly configured loopback HTTP during local development', async () => {
    expect(await configuredCorsHeader('http://localhost:3001', 'test')).toBe('http://localhost:3001');
    expect(await configuredCorsHeader('http://127.0.0.1:3001', 'test')).toBe('http://127.0.0.1:3001');
  });

  it('rejects insecure loopback HTTP for production and lookalike domains in development', async () => {
    expect(await configuredCorsHeader('http://localhost:3001', 'production')).toBe(DEFAULT_ORIGIN);
    expect(await configuredCorsHeader('http://localhost.attacker.example', 'test')).toBe(DEFAULT_ORIGIN);
  });
});
