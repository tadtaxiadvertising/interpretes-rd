// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: { qAScore: { findMany: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: vi.fn() }));

import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { GET, POST } from '../route';

const getRequest = () => new Request('http://localhost/api/v1/qa?limit=10');
const validScore = {
  productionLogId: 22, interpreterId: 7, auditDate: '2026-11-14',
  protocolScore: 8, interpretationScore: 8, languageScore: 8,
  serviceScore: 8, technicalScore: 8, criticalError: false,
};
const postRequest = (body: unknown) => new Request('http://localhost/api/v1/qa', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('admin QA score API privacy and error isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guardApiAuth).mockResolvedValue(null);
    vi.mocked(prisma.qAScore.findMany).mockResolvedValue([
      { id: 'qa-1', interpreterId: 7, auditor: 'Private Reviewer' },
    ] as never);
    vi.mocked(prisma.qAScore.create).mockResolvedValue({ id: 'qa-1', totalScore: 8 } as never);
  });

  it('denies a non-admin before reading QA records and marks the error private', async () => {
    vi.mocked(guardApiAuth).mockResolvedValueOnce(
      Response.json({ success: false, error: 'Forbidden' }, { status: 403 }) as never,
    );
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(prisma.qAScore.findMany).not.toHaveBeenCalled();
  });

  it('returns QA details with private cache headers', async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Cookie');
    expect((await res.json())[0].auditor).toBe('Private Reviewer');
  });

  it('does not leak provider messages on failed QA queries', async () => {
    const error = new Error('postgresql://private:PRIVATE_PASSWORD@internal.invalid/qa');
    error.name = 'Bearer PRIVATE_TOKEN';
    vi.mocked(prisma.qAScore.findMany).mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET(getRequest());
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: 'Unable to fetch QA scores' });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_|postgresql:/);
      expect(log).toHaveBeenCalledWith('Error fetching QA scores:', 'Error');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    } finally { log.mockRestore(); }
  });

  it('keeps score writes private and rejects invalid dimensions before DB writes', async () => {
    const invalid = await POST(postRequest({ ...validScore, protocolScore: 999 }));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.qAScore.create).not.toHaveBeenCalled();

    const valid = await POST(postRequest(validScore));
    expect(valid.status).toBe(201);
    expect(valid.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.qAScore.create).toHaveBeenCalledOnce();
  });

  it('returns generic private errors for failed QA writes, not leaked credentials', async () => {
    vi.mocked(prisma.qAScore.create).mockRejectedValueOnce(
      new Error('PRIVATE_QA_DATABASE_TOKEN'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(postRequest(validScore));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: 'Unable to create QA score' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_QA_DATABASE_TOKEN');
      expect(log).toHaveBeenCalledWith('QA API ERROR:', 'Error');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    } finally { log.mockRestore(); }
  });
});
