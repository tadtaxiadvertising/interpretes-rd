// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findMany: vi.fn() },
    productionLog: { findMany: vi.fn() },
    payrollRecord: { findUnique: vi.fn() },
    systemConfig: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: vi.fn() }));
vi.mock('@/services/PayrollService', () => ({
  calculateFullPayroll: vi.fn(),
  recalculateWithVerifiedMinutes: vi.fn(),
}));

import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { calculateFullPayroll } from '@/services/PayrollService';
import { POST as generatePayroll } from '../generate/route';
import { PATCH as payPayroll } from '../pay/route';
import { POST as verifyPayroll } from '../verify/route';
import { GET as getIncentives, POST as setIncentives } from '../../../config/incentives/route';

const request = (path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown) =>
  new Request('https://interpretes.example' + path, {
    method,
    ...(method === 'GET' ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  });
const generate = () => generatePayroll(request('/api/v1/payroll/generate', 'POST'));
const pay = () => payPayroll(request('/api/v1/payroll/pay', 'PATCH', {
  payrollRecordId: 'pay-1', transactionReference: 'BANK-123',
}));
const verify = () => verifyPayroll(request('/api/v1/payroll/verify', 'POST', {
  payrollRecordId: 'pay-1', action: 'markPaid',
}));
const incentivesGet = () => getIncentives(request('/api/config/incentives', 'GET'));
const incentivesPost = () => setIncentives(request('/api/config/incentives', 'POST', {
  tiers: [{ tierNumber: 1, hours: 100, bonus: 50 }],
}));

function assertPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const name of ['Authorization', 'Cookie', 'Origin']) {
    expect(response.headers.get('Vary')).toContain(name);
  }
}

function privateProviderError() {
  const error = new Error('postgresql://admin:PRIVATE_DB_PASSWORD@internal.invalid/payroll');
  error.name = 'Bearer PRIVATE_TOKEN';
  return error;
}

const secrets = /PRIVATE_DB_PASSWORD|PRIVATE_TOKEN|internal\.invalid|postgresql:\/\//;

describe('financial administrative API private error boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guardApiAuth).mockResolvedValue(null);
  });

  it.each([
    ['payroll generation', generate],
    ['payroll payment', pay],
    ['payroll verification', verify],
    ['incentive read', incentivesGet],
    ['incentive update', incentivesPost],
  ])('blocks unauthenticated %s before querying financial data', async (_name, run) => {
    vi.mocked(guardApiAuth).mockResolvedValueOnce(
      Response.json({ error: 'Forbidden' }, { status: 403 }) as never,
    );
    const response = await run();
    expect(response.status).toBe(403);
    assertPrivate(response);
    expect(prisma.interpreter.findMany).not.toHaveBeenCalled();
    expect(prisma.payrollRecord.findUnique).not.toHaveBeenCalled();
    expect(prisma.systemConfig.findMany).not.toHaveBeenCalled();
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['generation', generate, () => vi.mocked(prisma.interpreter.findMany).mockRejectedValueOnce(privateProviderError()), 'Internal Server Error'],
    ['payment', pay, () => vi.mocked(prisma.payrollRecord.findUnique).mockRejectedValueOnce(privateProviderError()), 'Internal Server Error'],
    ['verification', verify, () => vi.mocked(prisma.payrollRecord.findUnique).mockRejectedValueOnce(privateProviderError()), 'Internal server error'],
    ['incentives read', incentivesGet, () => vi.mocked(prisma.systemConfig.findMany).mockRejectedValueOnce(privateProviderError()), 'Failed to fetch incentive config'],
    ['incentives update', incentivesPost, () => vi.mocked(prisma.systemConfig.upsert).mockRejectedValueOnce(privateProviderError()), 'Failed to save incentive config'],
  ])('redacts provider exceptions on %s', async (_name, run, fail, fallback) => {
    fail();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await run();
      expect(response.status).toBe(500);
      assertPrivate(response);
      expect(await response.json()).toEqual({ success: false, error: fallback });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(secrets);
      expect(log).toHaveBeenCalledWith(expect.any(String), 'Error');
    } finally { log.mockRestore(); }
  });

  it('does not expose per-interpreter transaction errors from batch payroll generation', async () => {
    vi.mocked(prisma.interpreter.findMany).mockResolvedValueOnce([{ id: 7 }] as never);
    vi.mocked(prisma.productionLog.findMany).mockResolvedValueOnce([
      { id: 42, date: new Date('2026-11-16T12:00:00.000Z') },
    ] as never);
    vi.mocked(calculateFullPayroll).mockResolvedValueOnce({
      totalMinutes: 60, grossTotal: 20, qualityBonus: 0, incentivesTotal: 0,
      penalidades: 0, transferDeduction: 0, netTotal: 20,
    } as never);
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(privateProviderError());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await generate();
      expect(response.status).toBe(200);
      assertPrivate(response);
      expect(await response.json()).toEqual({
        success: true,
        results: [{ interpreterId: 7, error: 'No se pudo procesar este registro de nómina.', status: 'Failed' }],
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(secrets);
      expect(log).toHaveBeenCalledWith('Payroll generation failed for one interpreter:', 'Error');
    } finally { log.mockRestore(); }
  });

  it('keeps successful incentive configuration private', async () => {
    vi.mocked(prisma.systemConfig.findMany).mockResolvedValueOnce([] as never);
    const response = await incentivesGet();
    expect(response.status).toBe(200);
    assertPrivate(response);
    expect((await response.json()).success).toBe(true);
  });
});
