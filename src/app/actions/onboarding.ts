'use server';

import prisma from '@/lib/prisma';
import type { ActionResult } from '@/lib/types';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { validateAction } from '@/lib/auth/actions';
import { z } from 'zod';
import { hasCurrentLegalAcceptance, recordCurrentLegalAcceptance } from '@/app/actions/legal-agreements';

const db = prisma;

const CEDULA_REGEX = /^\d{3}-\d{7}-\d{1}$/;

/**
 * Version of the legal agreement presented during onboarding. Bump this when
 * the contract text changes so the accepted version is traceable per user.
 */
function termsMarker(now: Date, version: string): string {
  return `[TERMS_ACCEPTED] signed at ${now.toISOString()} (v${version})`;
}

const BankingDetailsSchema = z.object({
  bankName: z.string().min(1, 'Selecciona un banco').trim(),
  bankAccount: z.string().min(5, 'El número de cuenta debe tener al menos 5 dígitos').regex(/^\d+$/, 'Solo números permitidos').trim(),
  bankAccountType: z.enum(['Ahorro', 'Corriente'], { message: 'Selecciona el tipo de cuenta' }),
  bankCedula: z.string().regex(CEDULA_REGEX, 'Formato de cédula: XXX-XXXXXXX-X').trim(),
});

/**
 * Accept legal terms — records the signatureDate on the user's profile.
 * GUARD: Rejects if onboarding is already complete (canonical state).
 */
export async function acceptTerms(expectedAgreementId: string): Promise<ActionResult> {
  const auth = await validateAction();
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const actor = auth.user;
    const isAuthJsUser = actor.provider === 'authjs';

    // ── Guard: block if onboarding already completed (canonical state) ──
    if (!isAuthJsUser) {
      const profile = await db.userProfile.findUnique({
        where: { id: actor.userId },
        select: { onboardingComplete: true },
      });
      if (profile?.onboardingComplete) {
        return { success: false, error: 'Onboarding ya fue completado — no puedes modificar los datos', code: 'CONFLICT' };
      }
    } else if (actor.interpreterId) {
      const interpreter = await db.interpreter.findUnique({
        where: { id: actor.interpreterId },
        select: { documentosCompleto: true },
      });
      if (interpreter?.documentosCompleto) {
        return { success: false, error: 'Onboarding ya fue completado — no puedes modificar los datos', code: 'CONFLICT' };
      }
    }

    const now = new Date();
    let changedInterpreterId = actor.interpreterId ?? null;

    if (!expectedAgreementId || expectedAgreementId.length > 100) {
      return { success: false, error: 'Actualiza la página y vuelve a revisar el acuerdo vigente.', code: 'VALIDATION_ERROR' };
    }

    if (isAuthJsUser) {
      if (!actor.interpreterId) {
        return { success: false, error: 'No hay un perfil de intérprete vinculado a esta cuenta.', code: 'NOT_FOUND' };
      }
      await db.$transaction(async (tx) => {
        const current = await recordCurrentLegalAcceptance(tx, {
          interpreterId: actor.interpreterId,
          email: actor.email || 'unknown',
        });
        if (current.id !== expectedAgreementId) throw new Error('LEGAL_VERSION_CHANGED');
        const interpreter = await tx.interpreter.findUnique({
          where: { id: actor.interpreterId! },
          select: { notas: true },
        });
        const notes = interpreter?.notas || '';
        if (!notes.includes(`v${current.version}`)) {
          await tx.interpreter.update({
            where: { id: actor.interpreterId! },
            data: { notas: `${notes}\n${termsMarker(now, current.version)}`.trim() },
            select: { id: true },
          });
        }
        changedInterpreterId = actor.interpreterId;
      });
    } else {
      await db.$transaction(async (tx) => {
        const profile = await tx.userProfile.update({
          where: { id: actor.userId },
          data: { termsAcceptedAt: now, signatureDate: now },
          select: { interpreterId: true },
        });
        const current = await recordCurrentLegalAcceptance(tx, {
          userId: actor.userId,
          email: actor.email || 'unknown',
        });
        if (current.id !== expectedAgreementId) throw new Error('LEGAL_VERSION_CHANGED');
        if (profile?.interpreterId) {
          changedInterpreterId = profile.interpreterId;
          const interpreter = await tx.interpreter.findUnique({
            where: { id: profile.interpreterId },
            select: { notas: true },
          });
          const notes = interpreter?.notas || '';
          if (!notes.includes(`v${current.version}`)) {
            await tx.interpreter.update({
              where: { id: profile.interpreterId },
              data: { notas: `${notes}\n${termsMarker(now, current.version)}`.trim() },
              select: { id: true },
            });
          }
        }
      });
    }

    revalidateInterpreterProfileRecords(changedInterpreterId);
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message === 'LEGAL_VERSION_CHANGED') {
      return { success: false, error: 'El acuerdo vigente cambió mientras lo leías. Recarga la página y revisa la nueva versión antes de aceptar.', code: 'BAD_REQUEST' };
    }
    // The database's partial unique indexes are the final concurrency guard.
    // If another tab/request committed this exact acceptance first, treat the
    // uniqueness conflict as an idempotent success only when this version is
    // still current and the same stable identity has its verified acceptance.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const current = await db.legalAgreementVersion.findFirst({
        where: { agreementKey: 'freelance-services', status: 'PUBLISHED', publishedAt: { not: null } },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true },
      });
      const identity = auth.user.provider === 'authjs'
        ? { interpreterId: auth.user.interpreterId }
        : { userId: auth.user.userId };
      if (current?.id === expectedAgreementId && await hasCurrentLegalAcceptance(identity)) {
        revalidateInterpreterProfileRecords(auth.user.interpreterId ?? null);
        return { success: true };
      }
    }
    if (error instanceof Error && error.message.includes('No published legal agreement')) {
      return { success: false, error: 'No hay un acuerdo publicado para aceptar. Contacta al administrador.', code: 'BAD_REQUEST' };
    }
    console.error('[ONBOARDING] acceptTerms error:', error);
    return { success: false, error: 'Error inesperado al procesar la firma', code: 'INTERNAL_ERROR' };
  }
}

/**
 * Save RD banking details for the interpreter's payment profile.
 * GUARD: Rejects if onboarding is already complete (canonical state).
 */
export async function saveBankingDetails(data: {
  bankName: string;
  bankAccount: string;
  bankAccountType?: string;
  bankCedula: string;
}): Promise<ActionResult> {
  const auth = await validateAction();
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const actor = auth.user;
    const isAuthJsUser = actor.provider === 'authjs';

    // ── Guard: block if onboarding already completed (canonical state) ──
    if (!isAuthJsUser) {
      const existingProfile = await db.userProfile.findUnique({
        where: { id: actor.userId },
        select: { onboardingComplete: true },
      });
      if (existingProfile?.onboardingComplete) {
        return { success: false, error: 'Onboarding ya fue completado — los datos bancarios no pueden ser modificados', code: 'CONFLICT' };
      }
    } else if (actor.interpreterId) {
      const existingInterpreter = await db.interpreter.findUnique({
        where: { id: actor.interpreterId },
        select: { documentosCompleto: true },
      });
      if (existingInterpreter?.documentosCompleto) {
        return { success: false, error: 'Onboarding ya fue completado — los datos bancarios no pueden ser modificados', code: 'CONFLICT' };
      }
    }

    const validated = BankingDetailsSchema.parse(data);
    let changedInterpreterId = actor.interpreterId ?? null;

    if (isAuthJsUser) {
      if (actor.interpreterId) {
        await db.interpreter.update({
          where: { id: actor.interpreterId },
          data: {
            banco: validated.bankName,
            cuentaPago: validated.bankAccount,
            tipoCuenta: validated.bankAccountType,
            cedulaRnc: validated.bankCedula,
          },
          select: { id: true }
        });
        changedInterpreterId = actor.interpreterId;
      } else {
        return { success: false, error: 'No interpreter profile linked to this RBAC user', code: 'NOT_FOUND' };
      }
    } else {
      // ── Execute in Transaction for Supabase User ──────────────────────────
      await db.$transaction(async (tx) => {
        // 1. Update User Profile
        const profile = await tx.userProfile.update({
          where: { id: actor.userId },
          data: {
            bankName: validated.bankName,
            bankAccount: validated.bankAccount,
            bankAccountType: validated.bankAccountType,
            bankCedula: validated.bankCedula,
          },
          select: { interpreterId: true }
        });

        // 2. Sync with Interpreter record if linked
        if (profile?.interpreterId) {
          changedInterpreterId = profile.interpreterId;
          await tx.interpreter.update({
            where: { id: profile.interpreterId },
            data: {
              banco: validated.bankName,
              cuentaPago: validated.bankAccount,
              tipoCuenta: validated.bankAccountType,
              cedulaRnc: validated.bankCedula,
            },
            select: { id: true }
          });
        }
      });
    }

    revalidateInterpreterProfileRecords(changedInterpreterId);
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Datos bancarios inválidos', code: 'VALIDATION_ERROR' };
    }
    console.error('[ONBOARDING] saveBankingDetails error:', error);
    return { success: false, error: 'Ocurrió un error inesperado al guardar los datos', code: 'INTERNAL_ERROR' };
  }
}

/**
 * Mark onboarding as complete — enables full dashboard access.
 * GUARD: Rejects if onboarding was already completed (canonical state).
 * Updates BOTH canonical and legacy fields in a single transaction for Supabase users.
 */
export async function completeOnboarding(): Promise<ActionResult> {
  const auth = await validateAction();
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const actor = auth.user;
    const isAuthJsUser = actor.provider === 'authjs';
    const hasCurrentAgreement = await hasCurrentLegalAcceptance(
      isAuthJsUser ? { interpreterId: actor.interpreterId } : { userId: actor.userId }
    );
    let changedInterpreterId = actor.interpreterId ?? null;

    // ── Guard: prevent re-submission if already complete AND verify the
    //    required steps (terms + banking) were actually completed. ──
    if (!isAuthJsUser) {
      const existingProfile = await db.userProfile.findUnique({
        where: { id: actor.userId },
        select: {
          onboardingComplete: true,
          termsAcceptedAt: true,
          bankName: true,
          bankAccount: true,
          bankCedula: true,
        },
      });
      if (existingProfile?.onboardingComplete) {
        return { success: false, error: 'Onboarding ya fue completado previamente', code: 'CONFLICT' };
      }
      const hasTerms = hasCurrentAgreement;
      const hasBanking = !!(existingProfile?.bankName && existingProfile?.bankAccount && existingProfile?.bankCedula);
      if (!hasTerms || !hasBanking) {
        return { success: false, error: 'Completa la aceptación de términos y los datos bancarios antes de finalizar', code: 'BAD_REQUEST' };
      }
    } else if (actor.interpreterId) {
      const existingInterpreter = await db.interpreter.findUnique({
        where: { id: actor.interpreterId },
        select: {
          documentosCompleto: true,
          banco: true,
          cuentaPago: true,
          cedulaRnc: true,
          notas: true,
        },
      });
      if (existingInterpreter?.documentosCompleto) {
        return { success: false, error: 'Onboarding ya fue completado previamente', code: 'CONFLICT' };
      }
      const hasTerms = hasCurrentAgreement;
      const hasBanking = !!(existingInterpreter?.banco && existingInterpreter?.cuentaPago && existingInterpreter?.cedulaRnc);
      if (!hasTerms || !hasBanking) {
        return { success: false, error: 'Completa la aceptación de términos y los datos bancarios antes de finalizar', code: 'BAD_REQUEST' };
      }
    }

    if (isAuthJsUser) {
      if (actor.interpreterId) {
        await db.interpreter.update({
          where: { id: actor.interpreterId },
          data: {
            documentosCompleto: true,
            metodoPago: 'Transferencia Bancaria',
            status: 'Activo'
          },
          select: { id: true }
        });
        changedInterpreterId = actor.interpreterId;
      } else {
        return { success: false, error: 'No interpreter profile linked to this RBAC user', code: 'NOT_FOUND' };
      }
    } else {
      // ── Execute in Transaction for Supabase User ──────────────────────────
      // Update BOTH canonical (user_profiles.onboardingComplete) and legacy (interpreters.documentosCompleto)
      await db.$transaction(async (tx) => {
        const profile = await tx.userProfile.update({
          where: { id: actor.userId },
          data: { onboardingComplete: true },
          select: { interpreterId: true }
        });

        if (profile?.interpreterId) {
          changedInterpreterId = profile.interpreterId;
          await tx.interpreter.update({
            where: { id: profile.interpreterId },
            data: {
              documentosCompleto: true,
              metodoPago: 'Transferencia Bancaria',
              status: 'Activo'
            },
            select: { id: true }
          });
        }
      });
    }

    revalidateInterpreterProfileRecords(changedInterpreterId);
    return { success: true };
  } catch (error) {
    console.error('[ONBOARDING] completeOnboarding error:', error);
    return { success: false, error: 'Error inesperado al finalizar el onboarding', code: 'INTERNAL_ERROR' };
  }
}

/**
 * Get onboarding status for the current user.
 * Returns canonical state for Supabase users, legacy state for Auth.js users.
 */
export async function getOnboardingStatus(): Promise<ActionResult<{
  termsAccepted: boolean;
  bankingComplete: boolean;
  onboardingComplete: boolean;
}>> {
  const auth = await validateAction();
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const actor = auth.user;
    const isAuthJsUser = actor.provider === 'authjs';

    const currentTermsAccepted = await hasCurrentLegalAcceptance(
      isAuthJsUser ? { interpreterId: actor.interpreterId } : { userId: actor.userId }
    );

    if (isAuthJsUser) {
      if (!actor.interpreterId) {
        return {
          success: true,
          data: {
            termsAccepted: false,
            bankingComplete: false,
            onboardingComplete: false
          }
        };
      }

      const interpreter = await db.interpreter.findUnique({
        where: { id: actor.interpreterId },
        select: {
          documentosCompleto: true,
          banco: true,
          cuentaPago: true,
          cedulaRnc: true,
          notas: true
        }
      });

      if (!interpreter) return { success: false, error: 'Interpreter profile not found', code: 'NOT_FOUND' };

      const termsAccepted = currentTermsAccepted;
      const bankingComplete = !!(interpreter.banco && interpreter.cuentaPago && interpreter.cedulaRnc);
      const onboardingComplete = !!interpreter.documentosCompleto;

      return {
        success: true,
        data: {
          termsAccepted,
          bankingComplete,
          onboardingComplete
        }
      };
    } else {
      const profile = await db.userProfile.findUnique({
        where: { id: actor.userId },
        select: {
          termsAcceptedAt: true,
          bankName: true,
          bankAccount: true,
          bankCedula: true,
          onboardingComplete: true
        }
      });

      if (!profile) return { success: false, error: 'Profile not found', code: 'NOT_FOUND' };

      return {
        success: true,
        data: {
          termsAccepted: currentTermsAccepted,
          bankingComplete: !!(profile.bankName && profile.bankAccount && profile.bankCedula),
          onboardingComplete: profile.onboardingComplete,
        },
      };
    }
  } catch (err) {
    console.error('[ONBOARDING] getOnboardingStatus error:', err);
    return { success: false, error: 'Error fetching onboarding status', code: 'INTERNAL_ERROR' };
  }
}