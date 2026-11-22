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

  it('does not reflect unexpected environment values from the unauthenticated endpoint', async () => {
    vi.stubEnv('GIT_SHA', 'SYNTHETIC_PRIVATE_GIT_VALUE');
    vi.stubEnv('BUILD_TIMESTAMP', 'SYNTHETIC_PRIVATE_TIMESTAMP_VALUE');

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ buildTimestamp: null, buildId: null });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('rejects short, malformed or overlong release metadata without echoing it', async () => {
    const invalidValues = [
      { sha: 'a'.repeat(39), timestamp: 'not-a-date' },
      { sha: 'a'.repeat(41), timestamp: '2026-11-17T04:00:00Z-SYNTHETIC_EXTRA' },
      { sha: 'x'.repeat(40), timestamp: '2026-11-17T04:00:00+00:00' },
      { sha: 'SYNTHETIC_SECRET_SHOULD_NOT_APPEAR', timestamp: '2026-99-99T99:99:99Z' },
    ];
    for (const { sha, timestamp } of invalidValues) {
      vi.stubEnv('GIT_SHA', sha);
      vi.stubEnv('BUILD_TIMESTAMP', timestamp);
      expect(await (await GET()).json()).toEqual({ buildTimestamp: null, buildId: null });
    }
  });

  it('normalizes a valid 40-character Git SHA and accepts ISO milliseconds', async () => {
    const sha = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    vi.stubEnv('GIT_SHA', sha);
    vi.stubEnv('BUILD_TIMESTAMP', '2026-11-17T04:00:00.123Z');
    expect(await (await GET()).json()).toEqual({
      buildTimestamp: '2026-11-17T04:00:00.123Z',
      buildId: sha.toLowerCase(),
    });
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
