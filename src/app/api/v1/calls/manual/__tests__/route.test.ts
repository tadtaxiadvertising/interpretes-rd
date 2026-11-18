// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { interpreter: { findUnique: vi.fn() }, $transaction: vi.fn() },
}));
vi.mock('@/lib/interpreter-metrics', () => ({ getDayBounds: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
import { getDayBounds } from '@/lib/interpreter-metrics';
import { POST } from '../route';

const tx = {
  callSession: { create: vi.fn() },
  productionLog: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  callProductionEntry: { create: vi.fn() },
};

const request = (durationMinutes = 5, seconds = 0) => new Request(
  'https://interpretes.example/api/v1/calls/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ durationMinutes, seconds }),
  },
);

describe('POST /api/v1/calls/manual ledger and error privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue({
      profile: { role: 'interpreter', interpreterId: 7 },
    } as never);
    vi.mocked(prisma.interpreter.findUnique).mockResolvedValue({
      id: 7, tariffPerMinute: 0.20,
    } as never);
    vi.mocked(getDayBounds).mockReturnValue({
      startOfDay: new Date('2026-11-18T00:00:00Z'),
      endOfDay: new Date('2026-11-18T23:59:59.999Z'),
    });
    tx.callSession.create.mockResolvedValue({ id: 22, interpreterId: 7 });
    tx.productionLog.findFirst.mockResolvedValue(null);
    tx.productionLog.create.mockResolvedValue({ id: 99 });
    tx.productionLog.updateMany.mockResolvedValue({ count: 1 });
    tx.callProductionEntry.create.mockResolvedValue({ callSessionId: 22 });
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
    );
  });

  it('creates a new day, ledger and session in one serializable transaction', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toContain('Authorization');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(tx.callSession.create).toHaveBeenCalledOnce();
    expect(tx.productionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        interpreterId: 7, interpretedMinutes: 5, callsAttended: 1,
      }),
      select: { id: true },
    });
    expect(tx.callProductionEntry.create).toHaveBeenCalledWith({
      data: {
        callSessionId: 22,
        interpreterId: 7,
        productionDate: expect.any(Date),
        interpretedMinutes: 5,
        callsAttended: 1,
        productionLogId: 99,
      },
    });
  });

  it('updates existing production with a conditional settlement guard and records ledger', async () => {
    tx.productionLog.findFirst.mockResolvedValueOnce({
      id: 41, isSettled: false, interpretedMinutes: 15, callsAttended: 3,
    });
    const response = await POST(request(2, 30));
    expect(response.status).toBe(200);
    expect(tx.productionLog.updateMany).toHaveBeenCalledWith({
      where: { id: 41, isSettled: false },
      data: { interpretedMinutes: 17, callsAttended: 4 },
    });
    expect(tx.productionLog.create).not.toHaveBeenCalled();
    expect(tx.callProductionEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productionLogId: 41, interpretedMinutes: 2, callsAttended: 1 }),
    });
  });

  it('persists a zero-minute ledger row for a sub-minute session without creating production', async () => {
    const response = await POST(request(0, 45));
    expect(response.status).toBe(200);
    expect(tx.productionLog.findFirst).not.toHaveBeenCalled();
    expect(tx.productionLog.create).not.toHaveBeenCalled();
    expect(tx.callProductionEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        interpretedMinutes: 0, callsAttended: 0, productionLogId: null,
      }),
    });
  });

  it('rejects settled and concurrently settled days before ledger insertion', async () => {
    tx.productionLog.findFirst.mockResolvedValueOnce({
      id: 41, isSettled: true, interpretedMinutes: 15, callsAttended: 3,
    });
    const settled = await POST(request());
    expect(settled.status).toBe(409);
    expect(tx.productionLog.updateMany).not.toHaveBeenCalled();
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();

    tx.productionLog.findFirst.mockResolvedValueOnce({
      id: 41, isSettled: false, interpretedMinutes: 15, callsAttended: 3,
    });
    tx.productionLog.updateMany.mockResolvedValueOnce({ count: 0 });
    const changed = await POST(request());
    expect(changed.status).toBe(409);
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();
  });

  it('returns a private conflict on a serializable transaction race', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce({ code: 'P2034' });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(tx.callProductionEntry.create).not.toHaveBeenCalled();
  });

  it('fails the whole transaction if the per-session ledger cannot be inserted', async () => {
    tx.callProductionEntry.create.mockRejectedValueOnce(
      new Error('postgresql://private:PRIVATE_PASSWORD@internal.invalid/production'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ success: false, error: 'Internal Server Error' });
      expect(tx.callSession.create).toHaveBeenCalledOnce();
      expect(tx.callProductionEntry.create).toHaveBeenCalledOnce();
      expect(JSON.stringify(spy.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not leak a database URL or access token to clients or logs', async () => {
    const error = new Error('postgresql://admin:PRIVATE_DB_PASSWORD@private.host.invalid/data');
    error.name = 'Bearer PRIVATE_ACCESS_TOKEN';
    vi.mocked(prisma.interpreter.findUnique).mockRejectedValueOnce(error);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await POST(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ success: false, error: 'Internal Server Error' });
      expect(spy).toHaveBeenCalledWith('Error creating manual call log:', 'Error');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(
        /PRIVATE_DB_PASSWORD|PRIVATE_ACCESS_TOKEN|private[.]host[.]invalid|postgresql:/,
      );
    } finally { spy.mockRestore(); }
  });

  it('denies anonymous and non-interpreter requests before reading profile details', async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null as never);
    expect((await POST(request())).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValueOnce({
      profile: { role: 'candidate', interpreterId: 7 },
    } as never);
    expect((await POST(request())).status).toBe(401);
    expect(prisma.interpreter.findUnique).not.toHaveBeenCalled();
  });
});
