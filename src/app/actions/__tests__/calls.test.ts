import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T12:01:00.000Z'));
    validateActionMock.mockResolvedValue({
      user: { userId: 'auth-user-1' },
      profile: { interpreterId: 7 },
    });
    transactionClient.callSession.findFirst.mockResolvedValue({
      startedAt: new Date('2026-11-10T12:00:00.000Z'),
      tariffSnapshot: { toString: () => '0.5' },
    });
    transactionClient.callSession.update.mockImplementation(({ data }) => Promise.resolve({
      durationSeconds: data.durationSeconds,
      callCost: data.callCost,
      startedAt: new Date('2026-11-10T12:00:00.000Z'),
    }));
    transactionClient.interpreter.update.mockResolvedValue({ id: 7 });
    transactionClient.interpreterStatusLog.create.mockResolvedValue({ id: 1 });
    transactionClient.productionLog.findFirst.mockResolvedValue(null);
    transactionClient.productionLog.create.mockResolvedValue({ id: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates duration and cost, writes production, and settles the call atomically', async () => {
    const result = await endCall(99);

    expect(result).toEqual({
      success: true,
      data: { durationSeconds: 60, callCost: 0.5 },
    });
    expect(transactionClient.callSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 99, interpreterId: 7, endedAt: null },
      data: expect.objectContaining({
        endedAt: new Date('2026-11-10T12:01:00.000Z'),
        durationSeconds: 60,
        callCost: 0.5,
        isSettled: true,
      }),
    }));
    expect(transactionClient.productionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        interpreterId: 7,
        interpretedMinutes: 1,
        callsAttended: 1,
      }),
    }));
  });

  it('settles sub-minute calls without inventing a production minute', async () => {
    transactionClient.callSession.findFirst.mockResolvedValue({
      startedAt: new Date('2026-11-10T12:00:30.000Z'),
      tariffSnapshot: { toString: () => '0.5' },
    });

    const result = await endCall(100);

    expect(result).toMatchObject({
      success: true,
      data: { durationSeconds: 30, callCost: 0.25 },
    });
    expect(transactionClient.callSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ durationSeconds: 30, isSettled: true }),
    }));
    expect(transactionClient.productionLog.create).not.toHaveBeenCalled();
    expect(transactionClient.productionLog.update).not.toHaveBeenCalled();
  });
});
