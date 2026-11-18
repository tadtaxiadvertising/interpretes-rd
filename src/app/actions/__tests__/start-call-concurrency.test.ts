// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ validateAction: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    userProfile: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: vi.fn(),
}));

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { revalidatePath } from 'next/cache';
import { startCall } from '../calls';

const tx = {
  callSession: { create: vi.fn() },
  interpreter: { update: vi.fn() },
  interpreterStatusLog: { create: vi.fn() },
};
const startedAt = new Date('2026-11-18T18:00:00.000Z');

describe('startCall concurrency and post-commit acknowledgement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAction).mockResolvedValue({
      user: { userId: 'synthetic-profile', role: 'interpreter' },
      profile: { interpreterId: 7, role: 'interpreter' },
    } as never);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({
      interpreterId: 7,
      interpreter: { tariffPerMinute: 0.25, callSessions: [] },
    } as never);
    tx.callSession.create.mockResolvedValue({ id: 44, startedAt });
    tx.interpreter.update.mockResolvedValue({ id: 7 });
    tx.interpreterStatusLog.create.mockResolvedValue({ id: 3 });
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
    );
  });

  it('starts a call and commits session and interpreter status together', async () => {
    expect(await startCall()).toEqual({
      success: true,
      data: { sessionId: 44, startedAt: startedAt.toISOString() },
    });
    expect(tx.callSession.create).toHaveBeenCalledWith({
      data: { interpreterId: 7, tariffSnapshot: 0.25 },
      select: { id: true, startedAt: true },
    });
    expect(tx.interpreter.update).toHaveBeenCalledOnce();
    expect(tx.interpreterStatusLog.create).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
  });

  it('does not tell the interpreter a committed session failed when cache refresh throws', async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('postgresql://PRIVATE_SECRET@db.invalid/production');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await startCall()).toEqual({
        success: true,
        data: { sessionId: 44, startedAt: startedAt.toISOString() },
      });
      expect(warn).toHaveBeenCalledWith('Call started; cache refresh failed:', 'Error');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_SECRET');
      expect(tx.callSession.create).toHaveBeenCalledOnce();
    } finally { warn.mockRestore(); }
  });

  it('rejects an existing active session before starting another transaction', async () => {
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValueOnce({
      interpreterId: 7,
      interpreter: { tariffPerMinute: 0.25, callSessions: [{ id: 1 }] },
    } as never);
    expect(await startCall()).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reports a database unique_active_call race as a conflict, not an opaque internal error', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: 'unique_active_call' },
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await startCall()).toMatchObject({
        success: false, code: 'CONFLICT',
      });
      expect(error).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
  });

  it('returns a conflict for serializable transaction races without logging raw exceptions', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce({ code: 'P2034' });
    expect(await startCall()).toMatchObject({ success: false, code: 'CONFLICT' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('preserves a redacted internal error for unrelated failures before transaction commit', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_PASSWORD@internal.invalid/prod'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await startCall()).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
      expect(log).toHaveBeenCalledWith('Call action startCall failed:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_PASSWORD');
      expect(revalidatePath).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('requires an authenticated interpreter before reading profile or touching production', async () => {
    vi.mocked(validateAction).mockResolvedValueOnce({
      error: 'Not authorized', code: 'UNAUTHORIZED',
    } as never);
    expect(await startCall()).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
