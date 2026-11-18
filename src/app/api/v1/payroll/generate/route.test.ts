// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  productionFindMany: vi.fn(),
  transaction: vi.fn(),
  guard: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findFirst: mocks.findFirst, findMany: mocks.findMany },
    productionLog: { findMany: mocks.productionFindMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: mocks.guard }));
vi.mock('@/services/PayrollService', () => ({
  calculateFullPayroll: vi.fn(),
}));
vi.mock('@/lib/security/private-admin-response', () => ({
  privateAdminJson: (body: unknown, options?: ResponseInit) => Response.json(body, options),
  privateAdminResponse: (response: Response) => response,
}));

import { POST } from './route';

function request(body: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/v1/payroll/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('legacy payroll calendar — route guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue(null);
    mocks.findFirst.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects yesterday in Santo Domingo at 00:30 UTC, regardless of server TZ', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T00:30:00.000Z'));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        status: 'Activo',
        paymentFrequency: 'Biweekly',
        paymentDay: 'Tuesday',
      },
      select: { id: true },
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        status: 'Activo',
        OR: [
          { paymentFrequency: 'Monthly', paymentDay: '17' },
          { paymentFrequency: 'Weekly', paymentDay: 'Tuesday' },
        ],
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('respects an explicit YYYY-MM-DD day without shifting to the previous day', async () => {
    const response = await POST(request({ targetDate: '2026-11-18' }));
    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ paymentDay: 'Wednesday' }),
    }));
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        status: 'Activo',
        OR: [
          { paymentFrequency: 'Monthly', paymentDay: '18' },
          { paymentFrequency: 'Weekly', paymentDay: 'Wednesday' },
        ],
      },
    });
  });

  it('returns a validation error before database queries for impossible calendar dates', async () => {
    const response = await POST(request({ targetDate: '2026-02-30' }));
    expect(response.status).toBe(400);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('blocks unanchored biweekly cycles before any weekly/monthly write', async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: 1 });
    const response = await POST(request({ targetDate: '2026-11-18' }));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('BIWEEKLY_SCHEDULE_UNCONFIGURED');
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.productionFindMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller before looking up payroll schedules', async () => {
    mocks.guard.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
    const response = await POST(request({ targetDate: '2026-11-18' }));

    expect(response.status).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
