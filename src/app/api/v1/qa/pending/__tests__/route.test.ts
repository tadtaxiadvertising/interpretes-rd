// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: { callSession: { findMany: vi.fn() } },
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: vi.fn() }));

import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { GET } from '../route';

const req = () => new Request('http://localhost/api/v1/qa/pending');

function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const field of ['Cookie', 'Authorization', 'Origin']) {
    expect(response.headers.get('Vary')).toContain(field);
  }
}

describe('pending QA calls: privacy and safe failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guardApiAuth).mockResolvedValue(null);
    vi.mocked(prisma.callSession.findMany).mockResolvedValue([
      { id: 42, interpreter: { name: 'Synthetic Interpreter' } },
    ] as never);
  });

  it('blocks non-admin requests without querying sensitive call data', async () => {
    vi.mocked(guardApiAuth).mockResolvedValueOnce(
      Response.json({ success: false, error: 'Forbidden' }, { status: 403 }) as never,
    );
    const response = await GET(req());
    expect(response.status).toBe(403);
    expectPrivate(response);
    expect(prisma.callSession.findMany).not.toHaveBeenCalled();
  });

  it('marks successful results containing interpreter names as private', async () => {
    const response = await GET(req());
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect((await response.json())[0].interpreter.name).toBe('Synthetic Interpreter');
    expect(prisma.callSession.findMany).toHaveBeenCalledOnce();
  });

  it('does not expose arbitrary database provider messages, paths or injected names', async () => {
    const error = new Error('postgresql://admin:PRIVATE_PASSWORD@db.internal/qa');
    error.name = 'Bearer PRIVATE_TOKEN';
    vi.mocked(prisma.callSession.findMany).mockRejectedValueOnce(error);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(req());
      expect(response.status).toBe(500);
      expectPrivate(response);
      expect(await response.json()).toEqual({ error: 'Error fetching pending audits' });
      expect(spy).toHaveBeenCalledWith('Error fetching pending audits:', 'Error');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|db\.internal|postgresql:|PRIVATE_TOKEN/);
    } finally { spy.mockRestore(); }
  });
});
