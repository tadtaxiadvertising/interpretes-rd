import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

describe('GET /api/version', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports a stable unknown version when no build metadata was supplied', async () => {
    vi.stubEnv('GIT_SHA', '');
    vi.stubEnv('BUILD_TIMESTAMP', '');

    const first = await GET();
    const second = await GET();

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ buildTimestamp: null, buildId: null });
    expect(await second.json()).toEqual({ buildTimestamp: null, buildId: null });
    expect(first.headers.get('Cache-Control')).toContain('no-store');
  });

  it('reports explicitly configured provenance without generating a timestamp', async () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    vi.stubEnv('GIT_SHA', sha);
    vi.stubEnv('BUILD_TIMESTAMP', '2026-11-17T04:00:00Z');

    const response = await GET();

    expect(await response.json()).toEqual({
      buildTimestamp: '2026-11-17T04:00:00Z',
      buildId: sha,
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
});
