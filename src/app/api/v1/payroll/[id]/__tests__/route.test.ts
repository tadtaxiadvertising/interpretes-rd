// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    payrollRecord: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
    vi.mocked(prisma.payrollRecord.delete).mockResolvedValue({ id: 'pay-7' } as never);
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

  it('keeps valid updates private without changing Prisma write semantics', async () => {
    const res = await PATCH(patchRequest({ status: 'PAID' }), context);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(prisma.payrollRecord.update).toHaveBeenCalledWith({
      where: { id: 'pay-7' }, data: { status: 'PAID' },
    });
  });

  it('preserves not-found handling and redacts unexpected delete errors', async () => {
    vi.mocked(prisma.payrollRecord.delete).mockRejectedValueOnce({ code: 'P2025' });
    const missing = await DELETE(deleteRequest(), context);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Cache-Control')).toBe('private, no-store');

    vi.mocked(prisma.payrollRecord.delete).mockRejectedValueOnce(new Error('PRIVATE_DELETE_SECRET'));
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
