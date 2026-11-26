// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    payrollRecord: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/api-auth', () => ({ guardApiAuth: vi.fn() }));

import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { GET, PATCH, DELETE } from '../route';

const context = { params: Promise.resolve({ id: 'pay-7' }) };
const getRequest = () => new Request('http://localhost/api/v1/payroll/pay-7');
const patchRequest = (body: unknown) => new Request('http://localhost/api/v1/payroll/pay-7', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const deleteRequest = () => new Request('http://localhost/api/v1/payroll/pay-7', { method: 'DELETE' });

describe('private admin payroll record endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guardApiAuth).mockResolvedValue(null);
    vi.mocked(prisma.payrollRecord.findUnique).mockResolvedValue({
      id: 'pay-7', netTotal: 125, interpreter: { name: 'Private Worker' },
    } as never);
    vi.mocked(prisma.payrollRecord.update).mockResolvedValue({ id: 'pay-7', status: 'PAID' } as never);
    vi.mocked(prisma.payrollRecord.deleteMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.$transaction).mockImplementation(async callback => callback(prisma as never) as never);
  });

  it('does not query payroll data for a denied session and returns private 403', async () => {
    vi.mocked(guardApiAuth).mockResolvedValueOnce(
      Response.json({ success: false, error: 'Forbidden' }, { status: 403 }) as never,
    );
    const res = await GET(getRequest(), context);
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(prisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('keeps personal and financial record details private on 200 and 404', async () => {
    const response = await GET(getRequest(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toContain('Cookie');
    expect((await response.json()).interpreter.name).toBe('Private Worker');

    vi.mocked(prisma.payrollRecord.findUnique).mockResolvedValueOnce(null);
    const missing = await GET(getRequest(), context);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('does not leak Prisma connection details on GET failure', async () => {
    const error = new Error('postgresql://private:PRIVATE_PASSWORD@internal.invalid/db');
    error.name = 'Bearer PRIVATE_AUTH_TOKEN';
    vi.mocked(prisma.payrollRecord.findUnique).mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await GET(getRequest(), context);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: 'Unable to fetch payroll record' });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_|postgresql:/);
      expect(log).toHaveBeenCalledWith('Error fetching payroll record:', 'Error');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    } finally { log.mockRestore(); }
  });

  it('does not write malformed financial data and keeps validation errors private', async () => {
    const res = await PATCH(patchRequest({ grossTotal: -7 }), context);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.payrollRecord.update).not.toHaveBeenCalled();
  });

  it.each([{ status: 'PAID' }, { status: 'APPROVED' }, { status: 'REJECTED' }, { grossTotal: 100 }, { interpreterId: 8 }, { netTotal: 10 }])('requires the explicit workflow for generic mutations %j', async body => {
    const res = await PATCH(patchRequest(body), context);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: 'PAYROLL_WORKFLOW_REQUIRED' });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.payrollRecord.update).not.toHaveBeenCalled();
    expect(prisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('rejects unknown mutation fields without silently returning success', async () => {
    const res = await PATCH(patchRequest({ unknownField: 'value' }), context);
    expect(res.status).toBe(400);
    expect(prisma.payrollRecord.findUnique).not.toHaveBeenCalled();
    expect(prisma.payrollRecord.update).not.toHaveBeenCalled();
  });

  it('keeps empty PATCH read-only and private', async () => {
    const res = await PATCH(patchRequest({}), context);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.payrollRecord.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { id: 'pay-7' } });
    expect(prisma.payrollRecord.update).not.toHaveBeenCalled();
  });

  it('deletes only a draft with no payment or linked ledger records', async () => {
    expect((await DELETE(deleteRequest(), context)).status).toBe(200);
    expect(prisma.payrollRecord.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: {
      id: 'pay-7', status: 'Draft', paidAt: null, paymentDate: null,
      transactionReference: null, reconciliationHash: null,
      productionLogs: { none: {} }, callSessions: { none: {} },
    } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(prisma.payrollRecord.delete).not.toHaveBeenCalled();
  });

  it('preserves a protected payroll and reports serialization conflicts', async () => {
    vi.mocked(prisma.payrollRecord.deleteMany).mockResolvedValueOnce({ count: 0 });
    const response = await DELETE(deleteRequest(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PAYROLL_PROTECTED' });
    vi.mocked(prisma.$transaction).mockRejectedValueOnce({ code: 'P2034' });
    expect((await DELETE(deleteRequest(), context)).status).toBe(409);
    expect(prisma.payrollRecord.delete).not.toHaveBeenCalled();
  });

  it('preserves not-found handling and redacts unexpected delete errors', async () => {
    vi.mocked(prisma.payrollRecord.deleteMany).mockResolvedValueOnce({ count: 0 });
    vi.mocked(prisma.payrollRecord.findUnique).mockResolvedValueOnce(null);
    const missing = await DELETE(deleteRequest(), context);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Cache-Control')).toBe('private, no-store');

    vi.mocked(prisma.payrollRecord.deleteMany).mockRejectedValueOnce(new Error('PRIVATE_DELETE_SECRET'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await DELETE(deleteRequest(), context);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: 'Unable to delete payroll record' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_DELETE_SECRET');
      expect(log).toHaveBeenCalledWith('Error deleting payroll record:', 'Error');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    } finally { log.mockRestore(); }
  });
});
