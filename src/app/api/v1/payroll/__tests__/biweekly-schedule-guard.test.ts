// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findFirst: vi.fn(), findMany: vi.fn() },
    productionLog: { findMany: vi.fn() },
    payrollRecord: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: vi.fn() }));
vi.mock('@/services/PayrollService', () => ({ calculateFullPayroll: vi.fn() }));

import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { calculateFullPayroll } from '@/services/PayrollService';
import { POST } from '../generate/route';

const request = () => new Request('https://interpretes.example/api/v1/payroll/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ targetDate: '2026-11-16T12:00:00.000Z' }),
});

function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const key of ['Authorization', 'Cookie', 'Origin']) {
    expect(response.headers.get('Vary')).toContain(key);
  }
}

describe('biweekly payroll generation requires an anchored calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guardApiAuth).mockResolvedValue(null);
    vi.mocked(prisma.interpreter.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.interpreter.findMany).mockResolvedValue([] as never);
  });

  it('blocks unauthorized requests before looking at pay schedules', async () => {
    vi.mocked(guardApiAuth).mockResolvedValueOnce(
      Response.json({ error: 'Forbidden' }, { status: 403 }) as never,
    );
    const response = await POST(request());
    expect(response.status).toBe(403);
    expectPrivate(response);
    expect(prisma.interpreter.findFirst).not.toHaveBeenCalled();
    expect(prisma.interpreter.findMany).not.toHaveBeenCalled();
  });

  it('blocks an unanchored biweekly day before any payroll or production write', async () => {
    vi.mocked(prisma.interpreter.findFirst).mockResolvedValueOnce({ id: 12 } as never);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expectPrivate(response);
    const body = await response.json();
    expect(body).toMatchObject({
      success: false, code: 'BIWEEKLY_SCHEDULE_UNCONFIGURED',
    });
    expect(body.error).toContain('No se generó ninguna nómina');
    expect(JSON.stringify(body)).not.toContain('12');
    expect(prisma.interpreter.findFirst).toHaveBeenCalledWith({
      where: { status: 'Activo', paymentFrequency: 'Biweekly', paymentDay: 'Monday' },
      select: { id: true },
    });
    expect(prisma.interpreter.findMany).not.toHaveBeenCalled();
    expect(prisma.productionLog.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(calculateFullPayroll).not.toHaveBeenCalled();
  });

  it('never silently selects biweekly workers as weekly when no anchor is available', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect((await response.json()).count).toBe(0);
    expect(prisma.interpreter.findMany).toHaveBeenCalledWith({
      where: {
        status: 'Activo',
        OR: [
          { paymentFrequency: 'Monthly', paymentDay: '16' },
          { paymentFrequency: 'Weekly', paymentDay: 'Monday' },
        ],
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not leak provider errors from the schedule preflight', async () => {
    vi.mocked(prisma.interpreter.findFirst).mockRejectedValueOnce(
      new Error('postgresql://user:SENSITIVE_TOKEN@private-db.invalid/payroll'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(request());
      expect(response.status).toBe(500);
      expectPrivate(response);
      expect(await response.json()).toEqual({
        success: false, error: 'Internal Server Error',
      });
      expect(log).toHaveBeenCalledWith('Payroll generation request failed:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/SENSITIVE_TOKEN|private-db\.invalid/);
    } finally { log.mockRestore(); }
  });
});
