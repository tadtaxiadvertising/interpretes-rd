// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { interpreter: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/interpreter-metrics', () => ({ getDayBounds: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
import { POST } from '../route';

const request = () => new Request('https://interpretes.example/api/v1/calls/manual', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ durationMinutes: 5, seconds: 0 }),
});

describe('POST /api/v1/calls/manual error privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue({
      profile: { interpreterId: 7 },
    } as never);
  });

  it('does not leak a database URL or access token to clients or logs', async () => {
    const secret = 'postgresql://admin:PRIVATE_DB_PASSWORD@private.host.invalid/data';
    const error = new Error(secret);
    error.name = 'Bearer PRIVATE_ACCESS_TOKEN';
    vi.mocked(prisma.interpreter.findUnique).mockRejectedValueOnce(error);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ success: false, error: 'Internal Server Error' });
      expect(spy).toHaveBeenCalledWith('Error creating manual call log:', 'Error');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(
        /PRIVATE_DB_PASSWORD|PRIVATE_ACCESS_TOKEN|private\.host\.invalid|postgresql:\/\//,
      );
    } finally { spy.mockRestore(); }
  });

  it('denies anonymous requests without reading interpreter details', async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null as never);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(prisma.interpreter.findUnique).not.toHaveBeenCalled();
  });
});
