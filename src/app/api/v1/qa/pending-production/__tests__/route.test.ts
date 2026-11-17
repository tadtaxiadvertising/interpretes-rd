// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: { productionLog: { findMany: vi.fn() } },
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: vi.fn() }));

import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { GET } from '../route';

const request = (query = '') =>
  new Request('https://interpretes.example/api/v1/qa/pending-production' + query);
const log = (id: number, date: string, interpreterId = 7) => ({
  id, interpreterId, date: new Date(date + 'T00:00:00.000Z'), status: 'Manual',
});

function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const value of ['Cookie', 'Authorization', 'Origin']) {
    expect(response.headers.get('Vary')).toContain(value);
  }
}

describe('GET unreviewed production logs for admin QA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guardApiAuth).mockResolvedValue(null);
    vi.mocked(prisma.productionLog.findMany).mockResolvedValue([] as never);
  });

  it('rejects unauthorized requests before touching production data', async () => {
    vi.mocked(guardApiAuth).mockResolvedValueOnce(
      Response.json({ error: 'Forbidden' }, { status: 403 }) as never,
    );
    const response = await GET(request());
    expect(response.status).toBe(403);
    expectPrivate(response);
    expect(prisma.productionLog.findMany).not.toHaveBeenCalled();
  });

  it('filters for unaudited ProductionLog rows, never recent completed calls', async () => {
    vi.mocked(prisma.productionLog.findMany).mockResolvedValueOnce([
      log(24, '2026-11-17'), log(23, '2026-11-16'), log(21, '2026-11-15'),
    ] as never);
    const response = await GET(request('?limit=2&interpreterId=7'));
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      success: true,
      data: [
        { id: 24, interpreterId: 7, date: '2026-11-17', status: 'Manual' },
        { id: 23, interpreterId: 7, date: '2026-11-16', status: 'Manual' },
      ],
      nextCursor: '2026-11-16:23',
      hasMore: true,
    });
    expect(prisma.productionLog.findMany).toHaveBeenCalledWith({
      where: { interpreterId: 7, qaScore: { is: null } },
      select: { id: true, interpreterId: true, date: true, status: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 3,
    });
  });

  it('returns a strict stable keyset boundary instead of offset pagination', async () => {
    const response = await GET(request('?cursor=2026-11-16:23&limit=10'));
    expect(response.status).toBe(200);
    expect((await response.json()).nextCursor).toBe(null);
    expect(prisma.productionLog.findMany).toHaveBeenCalledWith({
      where: {
        interpreterId: { not: null },
        qaScore: { is: null },
        OR: [
          { date: { lt: new Date('2026-11-16T00:00:00.000Z') } },
          { date: new Date('2026-11-16T00:00:00.000Z'), id: { lt: 23 } },
        ],
      },
      select: { id: true, interpreterId: true, date: true, status: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 11,
    });
  });

  it.each([
    '?limit=0', '?limit=101', '?limit=1.5', '?limit=abc', '?limit=999999999999',
    '?interpreterId=0', '?interpreterId=1.2', '?interpreterId=-8',
    '?cursor=invalid', '?cursor=2026-02-30:1', '?cursor=2026-11-17:0',
    '?cursor=2026-11-17:999999999999',
  ])('rejects malformed filters %s without querying the database', async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(prisma.productionLog.findMany).not.toHaveBeenCalled();
  });

  it('returns only the agreed envelope for an empty queue', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      success: true, data: [], nextCursor: null, hasMore: false,
    });
  });

  it('redacts sensitive database errors from logs and responses', async () => {
    vi.mocked(prisma.productionLog.findMany).mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_PASSWORD@internal.invalid/data'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(request());
      expect(response.status).toBe(500);
      expectPrivate(response);
      expect(await response.json()).toEqual({
        success: false, error: 'Unable to fetch unreviewed production logs',
      });
      expect(spy).toHaveBeenCalledWith('Error fetching unreviewed production logs:', 'Error');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|internal.invalid|postgresql:/);
    } finally { spy.mockRestore(); }
  });
});
