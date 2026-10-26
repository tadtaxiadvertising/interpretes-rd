import { describe, it, expect, vi, beforeEach } from 'vitest';
import { acceptTerms, saveBankingDetails, completeOnboarding, getOnboardingStatus } from '../onboarding';

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
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((cb) => cb({
      userProfile: { update: vi.fn(), findUnique: vi.fn() },
      interpreter: { update: vi.fn(), findUnique: vi.fn() },
    })),
  },
}));

vi.mock('@/app/actions/legal-agreements', () => ({
  hasCurrentLegalAcceptance: vi.fn(),
  recordCurrentLegalAcceptance: vi.fn(),
}));

vi.mock('@/lib/cache/revalidate-interpreter', () => ({
  revalidateInterpreterProfileRecords: vi.fn(),
}));

import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { hasCurrentLegalAcceptance, recordCurrentLegalAcceptance } from '@/app/actions/legal-agreements';

describe('Onboarding Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (hasCurrentLegalAcceptance as any).mockResolvedValue(true);
    (recordCurrentLegalAcceptance as any).mockResolvedValue({ id: 'agreement-1', version: '2026-10-01' });
  });

  const mockAuthUser = {
    userId: 'user-123',
    email: 'test@test.com',
    role: 'interpreter' as const,
    interpreterId: 42,
    profileId: 'user-123',
  };

  const mockAuthResult = {
    user: mockAuthUser,
    profile: {
      id: 'user-123',
      role: 'interpreter',
      interpreterId: 42,
      email: 'test@test.com',
      onboardingComplete: false,
    },
  };

  describe('acceptTerms', () => {
    it('rejects if onboarding already complete', async () => {
      (validateAction as any).mockResolvedValue(mockAuthResult);
      (prisma.userProfile.findUnique as any).mockResolvedValue({ onboardingComplete: true });

      const result = await acceptTerms('agreement-1');

      expect(result.success).toBe(false);
      expect(result.code).toBe('CONFLICT');
    });

    it('records terms acceptance (with version) for Supabase user', async () => {
      (validateAction as any).mockResolvedValue(mockAuthResult);
      (prisma.userProfile.findUnique as any).mockResolvedValue({ onboardingComplete: false });
      const profileUpdate = vi.fn().mockResolvedValue({ interpreterId: null });
      (prisma.$transaction as any).mockImplementation(async (cb: any) =>
        cb({
          userProfile: { update: profileUpdate },
          interpreter: { findUnique: vi.fn(), update: vi.fn() },
        })
      );

      const result = await acceptTerms();

      expect(result.success).toBe(true);
      expect(profileUpdate).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: expect.objectContaining({
          termsAcceptedAt: expect.any(Date),
          signatureDate: expect.any(Date),
        }),
        select: { interpreterId: true },
      });
    });
  });

  describe('saveBankingDetails', () => {
    it('rejects if onboarding already complete', async () => {
      (validateAction as any).mockResolvedValue(mockAuthResult);
      (prisma.userProfile.findUnique as any).mockResolvedValue({ onboardingComplete: true });

      const result = await saveBankingDetails({
        bankName: 'Banco Popular',
        bankAccount: '1234567890',
        bankAccountType: 'Ahorro',
        bankCedula: '001-1234567-8',
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe('CONFLICT');
    });

    it('validates banking data', async () => {
      (validateAction as any).mockResolvedValue(mockAuthResult);
      (prisma.userProfile.findUnique as any).mockResolvedValue({ onboardingComplete: false });

      const result = await saveBankingDetails({
        bankName: '',
        bankAccount: '123',
        bankAccountType: 'Invalid',
        bankCedula: 'invalid',
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('saves banking details in transaction for Supabase user', async () => {
      (validateAction as any).mockResolvedValue(mockAuthResult);
      (prisma.userProfile.findUnique as any).mockResolvedValue({ onboardingComplete: false });
      (prisma.$transaction as any).mockImplementation(async (cb: any) => {
        const tx = {
          userProfile: { update: vi.fn().mockResolvedValue({ interpreterId: 42 }) },
          interpreter: { update: vi.fn().mockResolvedValue({ id: 42 }) },
        };
        return cb(tx);
      });

      const result = await saveBankingDetails({
        bankName: 'Banco Popular',
        bankAccount: '1234567890',
        bankAccountType: 'Ahorro',
        bankCedula: '001-1234567-8',
      });

      expect(result.success).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('completeOnboarding', () => {
    it('rejects if onboarding already complete', async () => {
      (validateAction as any).mockResolvedValue(mockAuthResult);
      (prisma.userProfile.findUnique as any).mockResolvedValue({ onboardingComplete: true });

      const result = await completeOnboarding();

      expect(result.success).toBe(false);
      expect(result.code).toBe('CONFLICT');
    });

    it('rejects completion when terms or banking are missing', async () => {
      (validateAction as any).mockResolvedValue(mockAuthResult);
      (hasCurrentLegalAcceptance as any).mockResolvedValue(false);
      (prisma.userProfile.findUnique as any).mockResolvedValue({
        onboardingComplete: false,
        termsAcceptedAt: null,
        bankName: null,
        bankAccount: null,
        bankCedula: null,
      });

      const result = await completeOnboarding();

      expect(result.success).toBe(false);
      expect(result.code).toBe('BAD_REQUEST');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('completes onboarding for Supabase user in transaction', async () => {
      (validateAction as any).mockResolvedValue(mockAuthResult);
      (prisma.userProfile.findUnique as any).mockResolvedValue({
        onboardingComplete: false,
        termsAcceptedAt: new Date(),
        bankName: 'Banco Popular',
        bankAccount: '1234567890',
        bankCedula: '001-1234567-8',
      });
      (prisma.$transaction as any).mockImplementation(async (cb: any) => {
        const tx = {
          userProfile: { update: vi.fn().mockResolvedValue({ interpreterId: 42 }) },
          interpreter: { update: vi.fn().mockResolvedValue({ id: 42 }) },
        };
        return cb(tx);
      });

      const result = await completeOnboarding();

      expect(result.success).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('getOnboardingStatus', () => {
    it('returns canonical state for Supabase user', async () => {
      (validateAction as any).mockResolvedValue(mockAuthResult);
      (prisma.userProfile.findUnique as any).mockResolvedValue({
        termsAcceptedAt: new Date(),
        bankName: 'Banco Popular',
        bankAccount: '1234567890',
        bankCedula: '001-1234567-8',
        onboardingComplete: true,
      });

      const result = await getOnboardingStatus();

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        termsAccepted: true,
        bankingComplete: true,
        onboardingComplete: true,
      });
    });

    it('returns incomplete for user without data', async () => {
      (validateAction as any).mockResolvedValue(mockAuthResult);
      (hasCurrentLegalAcceptance as any).mockResolvedValue(false);
      (prisma.userProfile.findUnique as any).mockResolvedValue({
        termsAcceptedAt: null,
        bankName: null,
        bankAccount: null,
        bankCedula: null,
        onboardingComplete: false,
      });

      const result = await getOnboardingStatus();

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        termsAccepted: false,
        bankingComplete: false,
        onboardingComplete: false,
      });
    });
  });
});