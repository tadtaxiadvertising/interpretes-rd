import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOnboardingDetails,
  adminUpdateOnboardingDetails,
  adminResetOnboarding,
} from '../admin-onboarding';

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    userProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    interpreter: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';

const adminAuth = {
  user: { userId: 'admin-1', email: 'admin@example.com', role: 'admin', interpreterId: null, profileId: 'admin-1' },
  profile: { userId: 'admin-1', email: 'admin@example.com', role: 'admin', interpreterId: null, profileId: 'admin-1' },
};

const targetProfile = {
  id: PROFILE_ID,
  email: 'interpreter@example.com',
  displayName: 'Ana Intérprete',
  role: 'interpreter',
  onboardingComplete: true,
  termsAcceptedAt: new Date('2026-01-01'),
  signatureDate: new Date('2026-01-01'),
  bankName: 'Popular',
  bankAccount: '1234567890',
  bankAccountType: 'Ahorro',
  bankCedula: '001-1234567-8',
  interpreterId: 42,
  interpreter: { id: 42, name: 'Ana Intérprete', status: 'Activo' },
};

function mockTransaction() {
  const tx = {
    userProfile: { update: vi.fn().mockResolvedValue(targetProfile) },
    interpreter: { update: vi.fn().mockResolvedValue({ id: 42 }) },
  };
  (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(tx));
  return tx;
}

describe('Admin Onboarding Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (validateAction as any).mockResolvedValue(adminAuth);
  });

  describe('authorization', () => {
    it('rejects a non-admin actor without touching the database', async () => {
      (validateAction as any).mockResolvedValue({ error: 'Access denied: insufficient permissions', code: 'UNAUTHORIZED' });

      const update = await adminUpdateOnboardingDetails({
        userId: PROFILE_ID,
        bankName: 'Popular',
        bankAccount: '1234567890',
        bankAccountType: 'Ahorro',
        bankCedula: '001-1234567-8',
      });
      const reset = await adminResetOnboarding({ userId: PROFILE_ID });

      expect(update).toEqual({ success: false, error: 'Access denied: insufficient permissions', code: 'UNAUTHORIZED' });
      expect(reset).toEqual({ success: false, error: 'Access denied: insufficient permissions', code: 'UNAUTHORIZED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getOnboardingDetails', () => {
    it('returns the profile onboarding details', async () => {
      (prisma.userProfile.findUnique as any).mockResolvedValue(targetProfile);

      const result = await getOnboardingDetails(PROFILE_ID);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.userId).toBe(PROFILE_ID);
        expect(result.data.bankName).toBe('Popular');
        expect(result.data.interpreterId).toBe(42);
        expect(result.data.interpreterName).toBe('Ana Intérprete');
      }
    });

    it('returns NOT_FOUND when the profile does not exist', async () => {
      (prisma.userProfile.findUnique as any).mockResolvedValue(null);

      const result = await getOnboardingDetails('missing');

      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('NOT_FOUND');
    });
  });

  describe('adminUpdateOnboardingDetails', () => {
    it('updates banking data without fabricating onboarding or document completion', async () => {
      const tx = mockTransaction();

      const result = await adminUpdateOnboardingDetails({
        userId: PROFILE_ID,
        bankName: 'Banreservas',
        bankAccount: '9876543210',
        bankAccountType: 'Corriente',
        bankCedula: '002-7654321-0',
      });

      expect(result.success).toBe(true);
      expect(tx.userProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PROFILE_ID },
          data: expect.objectContaining({
            bankName: 'Banreservas',
            bankAccount: '9876543210',
            bankAccountType: 'Corriente',
            bankCedula: '002-7654321-0',
          }),
        })
      );
      expect(tx.interpreter.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 42 },
          data: expect.objectContaining({
            banco: 'Banreservas',
            cuentaPago: '9876543210',
            tipoCuenta: 'Corriente',
            cedulaRnc: '002-7654321-0',
          }),
        })
      );
      const profileUpdateData = (tx.userProfile.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      const interpreterUpdateData = (tx.interpreter.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(profileUpdateData).not.toHaveProperty('onboardingComplete');
      expect(interpreterUpdateData).not.toHaveProperty('documentosCompleto');
    });

    it('revalidates every surface that renders this data', async () => {
      mockTransaction();

      await adminUpdateOnboardingDetails({
        userId: PROFILE_ID,
        bankName: 'Popular',
        bankAccount: '1234567890',
        bankAccountType: 'Ahorro',
        bankCedula: '001-1234567-8',
      });

      expect(revalidatePath).toHaveBeenCalledWith('/admin/users');
      expect(revalidatePath).toHaveBeenCalledWith('/interpreters');
      expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    it('rejects invalid banking data before persisting', async () => {
      mockTransaction();

      const result = await adminUpdateOnboardingDetails({
        userId: PROFILE_ID,
        bankName: '',
        bankAccount: '123',
        bankAccountType: 'Invalid',
        bankCedula: 'nope',
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('VALIDATION_ERROR');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('banking and onboarding post-commit refresh safety', () => {
    const validBanking = {
      userId: PROFILE_ID,
      bankName: 'Banreservas',
      bankAccount: '9876543210',
      bankAccountType: 'Corriente' as const,
      bankCedula: '002-7654321-0',
    };

    it('returns success after banking commits even when the first cache path fails', async () => {
      const tx = mockTransaction();
      vi.mocked(revalidatePath).mockImplementationOnce(() => {
        throw new Error('postgresql://svc:PRIVATE_BANK_DB_PASSWORD@db.internal');
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const result = await adminUpdateOnboardingDetails(validBanking);
        expect(result.success).toBe(true);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.userProfile.update).toHaveBeenCalledTimes(1);
        expect(tx.interpreter.update).toHaveBeenCalledTimes(1);
        expect(revalidatePath).toHaveBeenCalledTimes(3);
        expect(revalidatePath).toHaveBeenCalledWith('/admin/users');
        expect(revalidatePath).toHaveBeenCalledWith('/interpreters');
        expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
        expect(revalidateInterpreterProfileRecords).toHaveBeenCalledWith(42);
        expect(JSON.stringify(warn.mock.calls)).not.toMatch(/postgresql:|PRIVATE_BANK_DB_PASSWORD|db\\.internal/);
      } finally { warn.mockRestore(); }
    });

    it('returns a committed reset as successful despite path and profile cache failures', async () => {
      const tx = mockTransaction();
      vi.mocked(revalidatePath).mockImplementationOnce(() => {
        throw new Error('PRIVATE_CACHE_TOKEN');
      });
      vi.mocked(revalidateInterpreterProfileRecords).mockImplementationOnce(() => {
        throw new Error('PRIVATE_PROFILE_TOKEN');
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const result = await adminResetOnboarding({ userId: PROFILE_ID });
        expect(result).toEqual({ success: true });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.userProfile.update).toHaveBeenCalledTimes(1);
        expect(tx.interpreter.update).toHaveBeenCalledTimes(1);
        expect(revalidatePath).toHaveBeenCalledTimes(3);
        expect(revalidateInterpreterProfileRecords).toHaveBeenCalledWith(42);
        expect(warn).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(warn.mock.calls)).not.toMatch(/PRIVATE_CACHE_TOKEN|PRIVATE_PROFILE_TOKEN/);
      } finally { warn.mockRestore(); }
    });

    it('does not revalidate when the banking transaction genuinely fails', async () => {
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('PRIVATE_BANK_TRANSACTION_SECRET'));
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const result = await adminUpdateOnboardingDetails(validBanking);
        expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(revalidateInterpreterProfileRecords).not.toHaveBeenCalled();
        expect(JSON.stringify([result, errorLog.mock.calls])).not.toContain('PRIVATE_BANK_TRANSACTION_SECRET');
      } finally { errorLog.mockRestore(); }
    });

    it('preserves reset failure if the actual transaction fails', async () => {
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('PRIVATE_RESET_SECRET'));
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const result = await adminResetOnboarding({ userId: PROFILE_ID });
        expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
        expect(revalidatePath).not.toHaveBeenCalled();
        expect(revalidateInterpreterProfileRecords).not.toHaveBeenCalled();
        expect(JSON.stringify([result, errorLog.mock.calls])).not.toContain('PRIVATE_RESET_SECRET');
      } finally { errorLog.mockRestore(); }
    });
  });

  describe('adminResetOnboarding', () => {
    it('clears onboarding state on both records and revalidates', async () => {
      const tx = mockTransaction();

      const result = await adminResetOnboarding({ userId: PROFILE_ID });

      expect(result.success).toBe(true);
      expect(tx.userProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PROFILE_ID },
          data: expect.objectContaining({
            onboardingComplete: false,
            termsAcceptedAt: null,
            bankName: null,
            bankAccount: null,
            bankCedula: null,
          }),
        })
      );
      expect(tx.interpreter.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 42 },
          data: expect.objectContaining({
            documentosCompleto: false,
            banco: null,
            cuentaPago: null,
            cedulaRnc: null,
          }),
        })
      );
      expect(revalidatePath).toHaveBeenCalledWith('/admin/users');
      expect(revalidatePath).toHaveBeenCalledWith('/interpreters');
      expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
    });
  });
});
