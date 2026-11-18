// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/auth', () => ({
  getCurrentProfile: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(),
    interpreterAccountAssignment: { updateMany: vi.fn() },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import {
  assignInterpreterToAccount,
  endInterpreterAccountAssignment,
} from './admin-account-assignments';

function form(fields: Record<string, string>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(fields)) result.set(key, value);
  return result;
}

const newAssignment = () => form({
  accountId: '4',
  interpreterId: '7',
  startsAt: '2026-11-18',
  endsAt: '',
  notes: 'Work assignment',
});
const endAssignment = () => form({
  assignmentId: '15',
  endsAt: '2026-11-20',
});

describe('account assignments: post-commit errors are not write failures', () => {
  const create = vi.fn();
  const findAccount = vi.fn();
  const findInterpreter = vi.fn();
  const findOverlap = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'admin' } as never);
    findAccount.mockResolvedValue({ id: 4 });
    findInterpreter.mockResolvedValue({ id: 7 });
    findOverlap.mockResolvedValue(null);
    create.mockResolvedValue({ id: 15 });
    vi.mocked(prisma.$transaction).mockImplementation(async callback => {
      return callback({
        account: { findUnique: findAccount },
        interpreter: { findUnique: findInterpreter },
        interpreterAccountAssignment: { findFirst: findOverlap, create },
      } as never) as never;
    });
    vi.mocked(prisma.interpreterAccountAssignment.updateMany)
      .mockResolvedValue({ count: 1 } as never);
  });

  function mockCacheFailure() {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('postgresql://svc:PRIVATE_PASSWORD@db.internal/production');
    });
    return vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  }

  it('reports an already-committed creation as successful and never repeats the insert', async () => {
    const warning = mockCacheFailure();
    try {
      const result = await assignInterpreterToAccount(newAssignment());
      expect(result).toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        select: { id: true },
        data: expect.objectContaining({ accountId: 4, interpreterId: 7 }),
      }));
      expect(revalidatePath).toHaveBeenCalledOnce();
      expect(revalidatePath).toHaveBeenCalledWith('/admin/accounts');
      expect(warning).toHaveBeenCalledWith(
        '[ADMIN_ACCOUNTS] Assignment saved but cache refresh failed', 'Error',
      );
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(/postgresql:|PRIVATE_PASSWORD|db\.internal/);
    } finally {
      warning.mockRestore();
    }
  });

  it('reports an already-committed end date as successful without a second mutation', async () => {
    const warning = mockCacheFailure();
    try {
      expect(await endInterpreterAccountAssignment(endAssignment())).toEqual({ success: true });
      expect(prisma.interpreterAccountAssignment.updateMany).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warning.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally {
      warning.mockRestore();
    }
  });

  it('still reports database failures and does not refresh cache before commit', async () => {
    create.mockRejectedValueOnce(new Error('synthetic database failure'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await assignInterpreterToAccount(newAssignment());
      expect(result.success).toBe(false);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith(
        '[ADMIN_ACCOUNTS] Assignment creation failed', 'Error',
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('preserves concurrent assignment conflict handling', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce({ code: 'P2034' });
    const result = await assignInterpreterToAccount(newAssignment());
    expect(result.success).toBe(false);
    expect(result.error).toContain('simultánea');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('does not claim success when an assignment was not ended', async () => {
    vi.mocked(prisma.interpreterAccountAssignment.updateMany)
      .mockResolvedValueOnce({ count: 0 } as never);
    const result = await endInterpreterAccountAssignment(endAssignment());
    expect(result.success).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('blocks non-administrators before database access', async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'interpreter' } as never);
    expect((await assignInterpreterToAccount(newAssignment())).success).toBe(false);
    expect((await endInterpreterAccountAssignment(endAssignment())).success).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.interpreterAccountAssignment.updateMany).not.toHaveBeenCalled();
  });
});
