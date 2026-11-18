// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ validateAction: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findUnique: vi.fn() },
    callSession: { create: vi.fn() },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: vi.fn(),
}));

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { revalidatePath } from 'next/cache';
import { addManualCall } from '../calls';

function input(startedAt = '2026-11-18T12:30:00.000Z', durationMinutes = '1.5', interpreterId = '7', notes?: string) {
  const form = new FormData();
  form.set('interpreterId', interpreterId);
  form.set('startedAt', startedAt);
  form.set('durationMinutes', durationMinutes);
  if (notes !== undefined) form.set('notes', notes);
  return form;
}

describe('admin manual call validation and committed result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAction).mockResolvedValue({
      user: { userId: 'synthetic-admin', role: 'admin' },
      profile: { role: 'admin' },
    } as never);
    vi.mocked(prisma.interpreter.findUnique).mockResolvedValue({
      tariffPerMinute: 2,
    } as never);
    vi.mocked(prisma.callSession.create).mockResolvedValue({ id: 77 } as never);
  });

  it('stores an explicit offset as the correct UTC instant with rounded seconds and cents', async () => {
    expect(await addManualCall(input('2026-11-18T08:30:00-04:00'))).toEqual({
      success: true, data: { id: 77 },
    });
    expect(prisma.callSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        interpreterId: 7,
        startedAt: new Date('2026-11-18T12:30:00.000Z'),
        endedAt: new Date('2026-11-18T12:31:30.000Z'),
        durationSeconds: 90,
        tariffSnapshot: 2,
        callCost: 3,
      }),
      select: { id: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/calls');
  });

  it('rejects a timezone-less datetime-local value rather than using the server timezone', async () => {
    for (const time of [
      '2026-11-18T08:30', 'not-a-date', '2026-13-18T10:00:00Z', '',
    ]) {
      expect(await addManualCall(input(time))).toMatchObject({
        success: false, code: 'VALIDATION_ERROR',
      });
    }
    expect(prisma.interpreter.findUnique).not.toHaveBeenCalled();
    expect(prisma.callSession.create).not.toHaveBeenCalled();
  });

  it('rejects malformed interpreter IDs, sub-second durations, huge values and excessive notes', async () => {
    for (const form of [
      input(undefined, '1.5', '7.4'),
      input(undefined, '0.001'),
      input(undefined, '40000000'),
      input(undefined, 'NaN'),
      input(undefined, '1.5', '7', 'x'.repeat(2_001)),
    ]) {
      expect(await addManualCall(form)).toMatchObject({
        success: false, code: 'VALIDATION_ERROR',
      });
    }
    expect(prisma.interpreter.findUnique).not.toHaveBeenCalled();
  });

  it('rejects rates that cannot fit the payment decimal without writing the session', async () => {
    vi.mocked(prisma.interpreter.findUnique).mockResolvedValueOnce({
      tariffPerMinute: -5,
    } as never);
    expect(await addManualCall(input())).toMatchObject({
      success: false, code: 'VALIDATION_ERROR',
    });
    vi.mocked(prisma.interpreter.findUnique).mockResolvedValueOnce({
      tariffPerMinute: 99999999999,
    } as never);
    expect(await addManualCall(input())).toMatchObject({
      success: false, code: 'VALIDATION_ERROR',
    });
    expect(prisma.callSession.create).not.toHaveBeenCalled();
  });

  it('acknowledges the committed row even if cache revalidation fails', async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => {
      throw new Error('PRIVATE_DATABASE_URL');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await addManualCall(input())).toEqual({
        success: true, data: { id: 77 },
      });
      expect(warn).toHaveBeenCalledWith('Admin manual call saved; cache refresh failed:', 'Error');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_DATABASE_URL');
      expect(prisma.callSession.create).toHaveBeenCalledOnce();
    } finally { warn.mockRestore(); }
  });

  it('does not reveal server database errors or write without admin authorization', async () => {
    vi.mocked(validateAction).mockResolvedValueOnce({
      error: 'Unauthorized', code: 'UNAUTHORIZED',
    } as never);
    expect(await addManualCall(input())).toMatchObject({
      success: false, code: 'UNAUTHORIZED',
    });
    expect(prisma.interpreter.findUnique).not.toHaveBeenCalled();
    expect(prisma.callSession.create).not.toHaveBeenCalled();
  });
});
