import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endCall } from '../calls';

const { prismaMock, transactionClient, validateActionMock } = vi.hoisted(() => {
  const transactionClient = {
    callSession: { findFirst: vi.fn(), update: vi.fn() },
    interpreter: { update: vi.fn() },
    interpreterStatusLog: { create: vi.fn() },
    productionLog: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  };
  return {
    transactionClient,
    prismaMock: {
      $transaction: vi.fn(async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient)),
    },
    validateActionMock: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: validateActionMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: vi.fn(),
}));

describe('endCall production settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateActionMock.mockResolvedValue({
      user: { userId: 'auth-user-1' },
      profile: { interpreterId: 7 },
    });
    transactionClient.callSession.findFirst.mockResolvedValue({
      startedAt: new Date(Date.now() - 120_000),
      tariffSnapshot: 0.5,
    });
    transactionClient.callSession.update.mockImplementation(({ data }) => Promise.resolve({
      durationSeconds: data.durationSeconds,
      callCost: data.callCost,
      startedAt: new Date(Date.now() - 120_000),
    }));
    transactionClient.interpreter.update.mockResolvedValue({ id: 7 });
    transactionClient.interpreterStatusLog.create.mockResolvedValue({ id: 1 });
    transactionClient.productionLog.findFirst.mockResolvedValue(null);
    transactionClient.productionLog.create.mockResolvedValue({ id: 1 });
  });

  it('calculates duration and cost, writes production, and settles the call atomically', async () => {
    const result = await endCall(99);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.durationSeconds).toBeGreaterThanOrEqual(120);
    expect(result.data.durationSeconds).toBeLessThanOrEqual(121);
    expect(result.data.callCost).toBeCloseTo(result.data.durationSeconds / 120, 2);
    expect(transactionClient.callSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 99, interpreterId: 7, endedAt: null },
      data: expect.objectContaining({
        endedAt: expect.any(Date),
        durationSeconds: expect.any(Number),
        callCost: expect.any(Number),
        isSettled: true,
      }),
    }));
    expect(transactionClient.productionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        interpreterId: 7,
        interpretedMinutes: expect.any(Number),
        callsAttended: 1,
      }),
    }));
  });

  it('settles sub-minute calls without inventing a production minute', async () => {
    transactionClient.callSession.findFirst.mockResolvedValue({
      startedAt: new Date(Date.now() - 30_000),
      tariffSnapshot: 0.5,
    });

    const result = await endCall(100);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.durationSeconds).toBeGreaterThanOrEqual(30);
    expect(result.data.durationSeconds).toBeLessThanOrEqual(31);
    expect(result.data.callCost).toBeCloseTo(result.data.durationSeconds / 120, 2);
    expect(transactionClient.callSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ durationSeconds: expect.any(Number), isSettled: true }),
    }));
    expect(transactionClient.productionLog.create).not.toHaveBeenCalled();
    expect(transactionClient.productionLog.update).not.toHaveBeenCalled();
  });
});
