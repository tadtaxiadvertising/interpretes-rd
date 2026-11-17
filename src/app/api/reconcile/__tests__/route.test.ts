// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// This pre-audit suite executes before prisma generate. Stub only the Prisma
// error class used by withSecurity, while exercising the real route wrapper.
vi.mock('@prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} },
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: vi.fn() }));
vi.mock('@/lib/payroll/reconcile-production-minutes', () => ({
  reconcileProductionMinutes: vi.fn(),
}));

import { guardApiAuth } from '@/lib/api-auth';
import { reconcileProductionMinutes } from '@/lib/payroll/reconcile-production-minutes';
import { PATCH } from '../route';

const request = (body: unknown = { logId: 73, verifiedMinutes: 47 }) =>
  new NextRequest('https://interpretes.example/api/reconcile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const process = (body?: unknown) => PATCH(request(body), undefined);

function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const key of ['Cookie', 'Authorization', 'Origin']) {
    expect(response.headers.get('Vary')).toContain(key);
  }
}

describe('PATCH /api/reconcile uses one shared guarded transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guardApiAuth).mockResolvedValue(null);
  });

  it('rejects unauthorized callers before any financial write', async () => {
    vi.mocked(guardApiAuth).mockResolvedValueOnce(
      Response.json({ success: false, error: 'Forbidden' }, { status: 403 }) as never,
    );
    const response = await process();
    expect(response.status).toBe(403);
    expectPrivate(response);
    expect(reconcileProductionMinutes).not.toHaveBeenCalled();
  });

  it.each([42.3, -1, 100_001, Number.MAX_SAFE_INTEGER, null, '60'])(
    'rejects invalid verified minutes %s without running reconciliation', async minutes => {
      const response = await process({ logId: 73, verifiedMinutes: minutes });
      expect(response.status).toBe(400);
      expectPrivate(response);
      expect(reconcileProductionMinutes).not.toHaveBeenCalled();
    },
  );

  it('rejects extra fields to prevent accidentally expanding the write API', async () => {
    const response = await process({ logId: 73, verifiedMinutes: 60, isSettled: false });
    expect(response.status).toBe(400);
    expect(reconcileProductionMinutes).not.toHaveBeenCalled();
  });

  it.each([
    ['NOT_FOUND', 404],
    ['INVALID_LOG', 400],
    ['SETTLED', 409],
    ['LOCKED_PAYROLL', 409],
    ['CONFLICT', 409],
  ] as const)('returns a private business error for %s', async (kind, status) => {
    vi.mocked(reconcileProductionMinutes).mockResolvedValueOnce({ kind } as never);
    const response = await process();
    expect(response.status).toBe(status);
    expectPrivate(response);
    expect((await response.json()).success).toBe(false);
    expect(reconcileProductionMinutes).toHaveBeenCalledWith(73, 47);
  });

  it('preserves legacy success response data without exposing it to caches', async () => {
    vi.mocked(reconcileProductionMinutes).mockResolvedValueOnce({
      kind: 'UPDATED', log: { id: 73, verifiedMinutes: 47 },
    } as never);
    const response = await process();
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      success: true, data: { id: 73, verifiedMinutes: 47 },
    });
  });

  it('masks database provider credentials from transaction exceptions and logs', async () => {
    const error = new Error('postgresql://admin:PRIVATE_DB_PASSWORD@db.internal.invalid/payroll');
    error.name = 'Bearer PRIVATE_TOKEN';
    vi.mocked(reconcileProductionMinutes).mockRejectedValueOnce(error);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await process();
      expect(response.status).toBe(500);
      expectPrivate(response);
      expect(await response.json()).toEqual({
        success: false, error: 'Internal Server Error',
      });
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(
        /PRIVATE_DB_PASSWORD|PRIVATE_TOKEN|db\.internal\.invalid|postgresql:\/\//,
      );
    } finally { spy.mockRestore(); }
  });
});
