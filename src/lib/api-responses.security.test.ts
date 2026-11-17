// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiError } from './api-responses';

describe('apiError secure-by-default response contract', () => {
  const error = new Error('postgresql://user:PRIVATE_PASSWORD@internal.invalid/data');

  it('does not expose provider exception messages unless deliberately requested', async () => {
    const response = apiError({ error, fallback: 'Operation unavailable' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false, error: 'Operation unavailable',
    });
  });

  it('permits an explicit, reviewed message opt-in for known safe errors', async () => {
    const response = apiError({
      error: new Error('A selected value is no longer available'),
      fallback: 'Operation unavailable',
      status: 409,
      exposeMessage: true,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false, error: 'A selected value is no longer available',
    });
  });

  it('keeps structured Zod validation failures at status 400', async () => {
    const result = z.object({ count: z.number().positive() }).safeParse({ count: -1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    const response = apiError({ error: result.error, fallback: 'Invalid input' });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Validation failed');
    expect(body.details).toHaveLength(1);
  });
});
