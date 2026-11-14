// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    recruitmentCandidate: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock('@/lib/api-auth', () => ({
  guardApiAuth: vi.fn(),
}));

import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { GET, PATCH, DELETE } from '../route';

const context = { params: Promise.resolve({ id: '7' }) };
const makeGet = () => new Request('http://localhost/api/v1/recruitment/7');
const makePatch = (body: unknown) => new Request('http://localhost/api/v1/recruitment/7', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const makeDelete = () => new Request('http://localhost/api/v1/recruitment/7', { method: 'DELETE' });

describe('/api/v1/recruitment/[id] private candidate records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guardApiAuth).mockResolvedValue(null);
    vi.mocked(prisma.recruitmentCandidate.findUnique).mockResolvedValue({
      id: 7, name: 'Private Candidate', email: 'private@example.test',
    } as never);
    vi.mocked(prisma.recruitmentCandidate.update).mockResolvedValue({
      id: 7, name: 'New Name',
    } as never);
    vi.mocked(prisma.recruitmentCandidate.delete).mockResolvedValue({ id: 7 } as never);
  });

  it('does not query private candidate data for an unauthenticated request', async () => {
    vi.mocked(guardApiAuth).mockResolvedValueOnce(
      Response.json({ success: false, error: 'Unauthorized' }, { status: 401 }) as never,
    );
    const res = await GET(makeGet(), context);
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(prisma.recruitmentCandidate.findUnique).not.toHaveBeenCalled();
  });

  it('never caches an authorized candidate detail containing PII', async () => {
    const res = await GET(makeGet(), context);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Cookie');
    expect((await res.json()).email).toBe('private@example.test');
  });

  it('returns a generic private error without logging raw database secrets', async () => {
    const privateError = new Error('postgresql://private:PRIVATE_PASSWORD@internal.invalid');
    privateError.name = 'Bearer PRIVATE_TOKEN';
    vi.mocked(prisma.recruitmentCandidate.findUnique).mockRejectedValueOnce(privateError);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET(makeGet(), context);
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(body).toEqual({ success: false, error: 'Unable to fetch candidate' });
      expect(JSON.stringify(body)).not.toContain('PRIVATE_PASSWORD');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_|postgresql:/);
      expect(log).toHaveBeenCalledWith('Error fetching candidate:', 'Error');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    } finally {
      log.mockRestore();
    }
  });

  it('preserves the not-found contract without revealing private details', async () => {
    vi.mocked(prisma.recruitmentCandidate.findUnique).mockResolvedValueOnce(null);
    const res = await GET(makeGet(), context);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('keeps candidate updates private and rejects untrusted field types', async () => {
    const invalid = await PATCH(makePatch({ name: 9 }), context);
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.recruitmentCandidate.update).not.toHaveBeenCalled();

    const valid = await PATCH(makePatch({ name: 'New Name' }), context);
    expect(valid.status).toBe(200);
    expect(valid.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.recruitmentCandidate.update).toHaveBeenCalled();
  });

  it('never returns or logs Prisma errors during candidate deletion', async () => {
    vi.mocked(prisma.recruitmentCandidate.delete).mockRejectedValueOnce(
      new Error('PRIVATE_DELETE_TOKEN'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await DELETE(makeDelete(), context);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: 'Unable to delete candidate' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_DELETE_TOKEN');
      expect(log).toHaveBeenCalledWith('Error deleting candidate:', 'Error');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    } finally {
      log.mockRestore();
    }
  });
});
