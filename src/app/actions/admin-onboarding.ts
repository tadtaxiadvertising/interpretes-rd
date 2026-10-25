'use server';

import prisma from '@/lib/prisma';
import type { ActionResult } from '@/lib/types';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { revalidatePath } from 'next/cache';
import { validateAction } from '@/lib/auth/actions';
import { z } from 'zod';

const db = prisma;

// ── Zod Schemas ──────────────────────────────────────────────────

const AdminOnboardingUpdateSchema = z.object({
  userId: z.string().uuid(),
  bankName: z.string().min(1, 'Bank name is required').trim(),
  bankAccount: z.string().min(5, 'Account number must be at least 5 digits').regex(/^\d+$/, 'Only digits allowed').trim(),
  bankAccountType: z.enum(['Ahorro', 'Corriente'], { message: 'Select account type' }),
  bankCedula: z.string().regex(/^\d{3}-\d{7}-\d{1}$/, 'Cédula format: XXX-XXXXXXX-X').trim(),
});

const AdminOnboardingResetSchema = z.object({
  userId: z.string().uuid(),
});

// ── Types ──────────────────────────────────────────────────────────

export interface OnboardingDetailData {
  userId: string;
  email: string;
  displayName: string | null;
  role: string | null;
  onboardingComplete: boolean;
  termsAcceptedAt: Date | null;
  signatureDate: Date | null;
  bankName: string | null;
  bankAccount: string | null;
  bankAccountType: string | null;
  bankCedula: string | null;
  interpreterId: number | null;
  interpreterName: string | null;
  interpreterStatus: string | null;
}

// ── Get onboarding details for a specific user (admin view) ──────

export async function getOnboardingDetails(userId: string): Promise<ActionResult<OnboardingDetailData>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const profile = await db.userProfile.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        onboardingComplete: true,
        termsAcceptedAt: true,
        signatureDate: true,
        bankName: true,
        bankAccount: true,
        bankAccountType: true,
        bankCedula: true,
        interpreterId: true,
        interpreter: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });

    if (!profile) return { success: false, error: 'User profile not found', code: 'NOT_FOUND' };

    return {
      success: true,
      data: {
        userId: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role,
        onboardingComplete: profile.onboardingComplete,
        termsAcceptedAt: profile.termsAcceptedAt,
        signatureDate: profile.signatureDate,
        bankName: profile.bankName,
        bankAccount: profile.bankAccount,
        bankAccountType: profile.bankAccountType,
        bankCedula: profile.bankCedula,
        interpreterId: profile.interpreterId,
        interpreterName: profile.interpreter?.name ?? null,
        interpreterStatus: profile.interpreter?.status ?? null,
      },
    };
  } catch (error) {
    console.error('[ADMIN-ONBOARDING] getOnboardingDetails error:', error);
    return { success: false, error: 'Error fetching onboarding details', code: 'INTERNAL_ERROR' };
  }
}

// ── Admin edits banking data without impersonating user acceptance/completion ──

export async function adminUpdateOnboardingDetails(input: unknown): Promise<ActionResult<OnboardingDetailData>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const validated = AdminOnboardingUpdateSchema.parse(input);

    const result = await db.$transaction(async (tx) => {
      const profile = await tx.userProfile.update({
        where: { id: validated.userId },
        data: {
          bankName: validated.bankName,
          bankAccount: validated.bankAccount,
          bankAccountType: validated.bankAccountType,
          bankCedula: validated.bankCedula,
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          onboardingComplete: true,
          termsAcceptedAt: true,
          signatureDate: true,
          bankName: true,
          bankAccount: true,
          bankAccountType: true,
          bankCedula: true,
          interpreterId: true,
          interpreter: {
            select: { id: true, name: true, status: true },
          },
        },
      });

      if (profile.interpreterId) {
        await tx.interpreter.update({
          where: { id: profile.interpreterId },
          data: {
            banco: validated.bankName,
            cuentaPago: validated.bankAccount,
            tipoCuenta: validated.bankAccountType,
            cedulaRnc: validated.bankCedula,
            metodoPago: 'Transferencia Bancaria',
          },
          select: { id: true },
        });
      }

      return profile;
    });

    revalidatePath('/admin/users');
    revalidatePath('/interpreters');
    revalidatePath('/dashboard');
    revalidateInterpreterProfileRecords(result.interpreterId);

    return {
      success: true,
      data: {
        userId: result.id,
        email: result.email,
        displayName: result.displayName,
        role: result.role,
        onboardingComplete: result.onboardingComplete,
        termsAcceptedAt: result.termsAcceptedAt,
        signatureDate: result.signatureDate,
        bankName: result.bankName,
        bankAccount: result.bankAccount,
        bankAccountType: result.bankAccountType,
        bankCedula: result.bankCedula,
        interpreterId: result.interpreterId,
        interpreterName: result.interpreter?.name ?? null,
        interpreterStatus: result.interpreter?.status ?? null,
      },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? 'Invalid banking data', code: 'VALIDATION_ERROR' };
    }
    console.error('[ADMIN-ONBOARDING] adminUpdateOnboardingDetails error:', error);
    return { success: false, error: 'Error updating onboarding details', code: 'INTERNAL_ERROR' };
  }
}

// ── Admin resets onboarding — forces the user to redo the wizard ──

export async function adminResetOnboarding(input: unknown): Promise<ActionResult> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const validated = AdminOnboardingResetSchema.parse(input);

    const result = await db.$transaction(async (tx) => {
      const profile = await tx.userProfile.update({
        where: { id: validated.userId },
        data: {
          onboardingComplete: false,
          termsAcceptedAt: null,
          signatureDate: null,
          bankName: null,
          bankAccount: null,
          bankAccountType: null,
          bankCedula: null,
        },
        select: { interpreterId: true },
      });

      if (profile.interpreterId) {
        await tx.interpreter.update({
          where: { id: profile.interpreterId },
          data: {
            banco: null,
            cuentaPago: null,
            tipoCuenta: null,
            cedulaRnc: null,
            documentosCompleto: false,
          },
          select: { id: true },
        });
      }

      return profile;
    });

    revalidatePath('/admin/users');
    revalidatePath('/interpreters');
    revalidatePath('/dashboard');
    revalidateInterpreterProfileRecords(result.interpreterId);

    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Invalid user ID', code: 'VALIDATION_ERROR' };
    }
    console.error('[ADMIN-ONBOARDING] adminResetOnboarding error:', error);
    return { success: false, error: 'Error resetting onboarding', code: 'INTERNAL_ERROR' };
  }
}
