// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    recruitmentCandidate: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/api-auth', () => ({
  guardApiAuth: vi.fn(),
  resolveApiActor: vi.fn(),
}));

import { GET } from '../route';
import { guardApiAuth } from '@/lib/api-auth';

describe('Recruitment API — role-based access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies anonymous (guard returns 401)', async () => {
    (guardApiAuth as any).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 }),
    );
    const res = await GET(new Request('http://localhost/api/v1/recruitment'));
    expect(res.status).toBe(401);
  });

  it('denies interpreter (guard returns 403)', async () => {
    (guardApiAuth as any).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status: 403 }),
    );
    const res = await GET(new Request('http://localhost/api/v1/recruitment'));
    expect(res.status).toBe(403);
  });

  it('allows admin (guard returns null)', async () => {
    (guardApiAuth as any).mockResolvedValue(null);
    const prisma = (await import('@/lib/prisma')).default as any;
    prisma.recruitmentCandidate.findMany.mockResolvedValue([]);
    const res = await GET(new Request('http://localhost/api/v1/recruitment'));
    expect(res.status).toBe(200);
  });
});
