// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  default: { payrollRecord: { findMany: vi.fn() } },
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: vi.fn() }));

import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { GET } from '../route';

const req = (query = '') => new NextRequest('http://localhost/api/v1/payroll' + query);

describe('GET /api/v1/payroll private admin list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guardApiAuth).mockResolvedValue(null);
    vi.mocked(prisma.payrollRecord.findMany).mockResolvedValue([
      { id: 'pay-1', netTotal: 999, interpreter: { name: 'Private Worker' } },
    ] as never);
  });

  it('never reads payroll records for a denied caller', async () => {
    vi.mocked(guardApiAuth).mockResolvedValueOnce(
      Response.json({ success: false, error: 'Forbidden' }, { status: 403 }) as never,
    );
    const res = await GET(req(), undefined);
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(prisma.payrollRecord.findMany).not.toHaveBeenCalled();
  });

  it('protects financial list responses from caching across admin identities', async () => {
    const res = await GET(req('?limit=10'), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Cookie');
    expect((await res.json())[0].interpreter.name).toBe('Private Worker');
    expect(prisma.payrollRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 10,
      orderBy: { periodStart: 'desc' },
    }));
  });

  it('keeps malformed list filters private and prevents unnecessary DB access', async () => {
    const res = await GET(req('?limit=0'), undefined);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.payrollRecord.findMany).not.toHaveBeenCalled();
  });
});
