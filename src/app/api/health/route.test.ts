import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/health', () => {
  it('exposes an uncached liveness probe with the current product identity', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'healthy',
      service: 'interpretes-rd',
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
});
