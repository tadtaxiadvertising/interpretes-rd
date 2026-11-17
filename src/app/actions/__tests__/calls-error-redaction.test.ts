import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ validateAction: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    userProfile: { findUnique: vi.fn() },
    callSession: { findFirst: vi.fn() },
    interpreter: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: vi.fn(),
}));

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { addManualCall, endCall, getActiveCall, startCall } from '../calls';

const authenticatedInterpreter = {
  user: { userId: 'test-profile', email: 'interpreter@example.invalid', role: 'interpreter' },
  profile: { interpreterId: 7, role: 'interpreter' },
};

const secret = 'postgresql://username:ULTRA_PRIVATE_PASSWORD@private.internal/database';
const unsafeError = () => {
  const error = new Error(secret);
  error.name = 'Bearer EXTRA_PRIVATE_TOKEN';
  return error;
};

function assertSafeFailureLog(spy: ReturnType<typeof vi.spyOn>) {
  expect(spy).toHaveBeenCalledOnce();
  expect(spy.mock.calls[0]?.[1]).toBe('Error');
  expect(JSON.stringify(spy.mock.calls)).not.toMatch(
    /ULTRA_PRIVATE_PASSWORD|private\.internal|EXTRA_PRIVATE_TOKEN|postgresql:\/\//,
  );
}

describe('call server actions do not log provider secrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAction).mockResolvedValue(authenticatedInterpreter as never);
  });

  it('redacts failures while starting a call', async () => {
    vi.mocked(prisma.userProfile.findUnique).mockRejectedValueOnce(unsafeError());
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await startCall()).success).toBe(false);
      assertSafeFailureLog(spy);
    } finally { spy.mockRestore(); }
  });

  it('redacts failures while ending a call', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(unsafeError());
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await endCall(123)).success).toBe(false);
      assertSafeFailureLog(spy);
    } finally { spy.mockRestore(); }
  });

  it('redacts failures while reading an active call', async () => {
    vi.mocked(prisma.callSession.findFirst).mockRejectedValueOnce(unsafeError());
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await getActiveCall()).success).toBe(false);
      assertSafeFailureLog(spy);
    } finally { spy.mockRestore(); }
  });

  it('redacts failures while recording a manual call', async () => {
    vi.mocked(prisma.interpreter.findUnique).mockRejectedValueOnce(unsafeError());
    const form = new FormData();
    form.set('interpreterId', '7');
    form.set('startedAt', '2026-11-17T12:00:00.000Z');
    form.set('durationMinutes', '5');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await addManualCall(form)).success).toBe(false);
      assertSafeFailureLog(spy);
    } finally { spy.mockRestore(); }
  });
});
