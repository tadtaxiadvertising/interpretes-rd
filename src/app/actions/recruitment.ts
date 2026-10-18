'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { ActionResult } from '@/lib/types';
import { validateAction } from '@/lib/auth/actions';
import { ApplicantSchema, ApplicantData } from '@/lib/validators/recruitment';
import type { Prisma } from '@prisma/client';
import {
  APPLICATION_REF_COOKIE,
  APPLICATION_REF_MAX_AGE_SEC,
  createApplicationRef,
  verifyApplicationRef,
} from '@/lib/recruitment/application-ref';

const db = prisma;

/** Funnel steps rendered by /postular (1 application, 2 induction, 3 roleplay, 4 setup). */
const FUNNEL_STEP_APPLICATION = 1;
const FUNNEL_STEP_INDUCTION = 2;
const FUNNEL_STEP_ROLEPLAY = 3;
const FUNNEL_STEP_SETUP = 4;

const ROLEPLAY_SUBMITTED_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'];

/**
 * Server-side source of truth for the funnel step. Never derived from a
 * client-supplied value: it is computed from the persisted application and
 * roleplay session state.
 */
async function deriveFunnelStep(
  tx: Pick<Prisma.TransactionClient, 'roleplaySession'>,
  candidateId: number,
  applicationStatus?: string
): Promise<number> {
  const session = await tx.roleplaySession.findFirst({
    where: { recruitmentCandidateId: candidateId },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  });

  if (session) {
    return ROLEPLAY_SUBMITTED_STATUSES.includes(session.status)
      ? FUNNEL_STEP_SETUP
      : FUNNEL_STEP_ROLEPLAY;
  }

  if (applicationStatus === 'ROLEPLAY_PENDING' || applicationStatus === 'ROLEPLAY_IN_PROGRESS') {
    return FUNNEL_STEP_ROLEPLAY;
  }

  return FUNNEL_STEP_INDUCTION;
}

/**
 * Only fills fields that are empty on the stored record. Used when a
 * submission for an existing email does NOT present a valid ownership
 * reference, so a third party can never overwrite another applicant's PII.
 */
function fillEmptyOnly(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === '') continue;
    const current = existing[key];
    const isEmpty = current === undefined || current === null || current === '';
    if (isEmpty) merged[key] = value;
  }
  return merged;
}

function issueApplicationRef(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  candidateId: number,
  applicationId: string
): boolean {
  const value = createApplicationRef(candidateId, applicationId);
  if (!value) {
    console.warn(
      '[recruitment] AUTH_SECRET no está configurado: no se emitió la cookie de propiedad de la postulación.'
    );
    return false;
  }
  cookieStore.set(APPLICATION_REF_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: APPLICATION_REF_MAX_AGE_SEC,
  });
  return true;
}

/**
 * Proof of ownership for an application:
 * 1. the signed `rd_app_ref` cookie issued to the browser that created it, or
 * 2. an authenticated account whose normalized email matches the candidate
 *    (the same trust model `startCandidateRoleplay` already uses).
 *
 * Returns null when neither proof is available, which is the anonymous
 * third-party case.
 */
async function resolveOwnership(): Promise<{
  candidateId: number;
  applicationId: string | null;
  source: 'cookie' | 'account';
} | null> {
  const cookieStore = await cookies();
  const ref = verifyApplicationRef(cookieStore.get(APPLICATION_REF_COOKIE)?.value ?? null);
  if (ref) return { candidateId: ref.candidateId, applicationId: ref.applicationId, source: 'cookie' };

  let actorEmail: string | null = null;
  try {
    const auth = await validateAction();
    if (auth && typeof auth === 'object' && 'user' in auth) {
      actorEmail = auth.user.email?.toLowerCase().trim() || null;
    }
  } catch {
    actorEmail = null;
  }
  if (!actorEmail) return null;

  const candidate = await db.recruitmentCandidate.findUnique({
    where: { email: actorEmail },
    select: { id: true, applications: { select: { id: true }, take: 1 } },
  });
  if (!candidate) return null;
  return { candidateId: candidate.id, applicationId: candidate.applications[0]?.id ?? null, source: 'account' };
}

type SubmitOutcome = {
  candidateId: number;
  applicationId: string;
  created: boolean;
  owned: boolean;
  funnelStep: number;
};

/**
 * ACTION: Submit Application (Public - no auth required)
 *
 * Idempotent create-or-resume keyed on the candidate email (unique).
 *
 * Ownership rules:
 * - New applicant -> record is created and the browser receives the signed
 *   `rd_app_ref` ownership cookie.
 * - Existing applicant presenting a valid ownership cookie -> full resume
 *   (profile refreshed) and the cookie is re-issued.
 * - Existing applicant WITHOUT the cookie -> only empty fields are filled;
 *   existing PII is never overwritten, and internal ids are not returned.
 */
export async function submitApplicationAction(data: ApplicantData) {
  try {
    // 1. Strict Zod validation (also normalizes email to lowercase)
    const parsed = ApplicantSchema.parse(data);
    const email = parsed.email;

    const notas = JSON.stringify({
      efsetLink: parsed.efsetLink,
      ...(parsed.cvUrl ? { cvUrl: parsed.cvUrl } : {}),
    });

    const profileData = {
      name: parsed.name,
      telefono: parsed.phone,
      pais: parsed.country,
      englishLevel: parsed.englishLevel,
      speedtestMbps: parsed.speedtestMbps,
      notas,
    } satisfies Record<string, unknown>;

    const cookieStore = await cookies();
    const ownership = await resolveOwnership();

    // 2. Create-or-resume inside a transaction. Retry once to absorb a
    //    concurrent first submission racing on the unique email.
    const runSubmit = (): Promise<SubmitOutcome> =>
      db.$transaction(async (tx) => {
        const existing = await tx.recruitmentCandidate.findUnique({
          where: { email },
          select: {
            id: true,
            name: true,
            telefono: true,
            pais: true,
            englishLevel: true,
            speedtestMbps: true,
            notas: true,
            applications: { select: { id: true, status: true }, take: 1 },
          },
        });

        if (existing) {
          const owned = ownership !== null && ownership.candidateId === existing.id;
          const dataToUpdate = owned ? profileData : fillEmptyOnly(profileData, existing);
          if (Object.keys(dataToUpdate).length > 0) {
            await tx.recruitmentCandidate.update({
              where: { id: existing.id },
              data: dataToUpdate,
            });
          }

          let application = existing.applications[0];
          if (application) {
            await tx.recruitmentApplication.update({
              where: { id: application.id },
              data: { lastActivityAt: new Date() },
            });
          } else {
            application = await tx.recruitmentApplication.create({
              data: {
                candidateId: existing.id,
                status: 'APPLIED',
                currentStep: 'APPLICATION',
                lastActivityAt: new Date(),
              },
              select: { id: true, status: true },
            });
            await tx.recruitmentEvent.create({
              data: {
                applicationId: application.id,
                eventType: 'APPLICATION_CREATED',
                toStatus: 'APPLIED',
                actorType: 'candidate',
                actorId: email,
                metadata: { source: 'Web Portal', resumed: true },
              },
            });
          }

          const funnelStep = await deriveFunnelStep(tx, existing.id, application.status);
          return {
            candidateId: existing.id,
            applicationId: application.id,
            created: false,
            owned,
            funnelStep,
          };
        }

        const created = await tx.recruitmentCandidate.create({
          data: {
            ...profileData,
            email,
            status: 'Aplicante',
            fuente: 'Web Portal',
          },
          select: { id: true },
        });
        const application = await tx.recruitmentApplication.create({
          data: {
            candidateId: created.id,
            status: 'APPLIED',
            currentStep: 'APPLICATION',
            lastActivityAt: new Date(),
          },
          select: { id: true, status: true },
        });
        await tx.recruitmentEvent.create({
          data: {
            applicationId: application.id,
            eventType: 'APPLICATION_CREATED',
            toStatus: 'APPLIED',
            actorType: 'candidate',
            actorId: email,
            metadata: { source: 'Web Portal' },
          },
        });

        const funnelStep = await deriveFunnelStep(tx, created.id, application.status);
        return {
          candidateId: created.id,
          applicationId: application.id,
          created: true,
          owned: true,
          funnelStep,
        };
      });

    let outcome: SubmitOutcome;
    try {
      outcome = await runSubmit();
    } catch (error) {
      const isUniqueViolation =
        error && typeof error === 'object' && 'code' in error && error.code === 'P2002';
      if (!isUniqueViolation) throw error;
      // Concurrent first submission won the race; resume now.
      outcome = await runSubmit();
    }

    // The browser that owns the application keeps (or receives) the reference.
    if (outcome.owned) {
      issueApplicationRef(cookieStore, outcome.candidateId, outcome.applicationId);
    }

    revalidatePath('/recruitment');

    const response: {
      success: true;
      alreadyApplied: boolean;
      funnelStep: number;
      candidateId?: number;
      applicationId?: string;
    } = {
      success: true,
      alreadyApplied: !outcome.created,
      funnelStep: outcome.funnelStep,
    };
    if (outcome.owned) {
      response.candidateId = outcome.candidateId;
      response.applicationId = outcome.applicationId;
    }
    return response;
  } catch (error) {
    console.error('[Recruitment Action Error]:', error);
    // Never expose database/provider details to anonymous applicants.
    return {
      success: false,
      error: 'No pudimos procesar tu postulación. Verifica tus datos e inténtalo de nuevo.',
    };
  }
}

/**
 * ACTION: Restore the applicant's funnel state (public, cookie-scoped).
 *
 * Returns PII (name/email) only when the request presents the signed
 * ownership reference of that application.
 */
export async function getMyApplicationAction() {
  try {
    const ownership = await resolveOwnership();
    if (!ownership || !ownership.applicationId) {
      return {
        success: true as const,
        data: { found: false as const, funnelStep: FUNNEL_STEP_APPLICATION },
      };
    }

    const candidate = await db.recruitmentCandidate.findUnique({
      where: { id: ownership.candidateId },
      select: {
        id: true,
        name: true,
        email: true,
        applications: { select: { id: true, status: true, currentStep: true }, take: 1 },
      },
    });
    const application = candidate?.applications[0];
    if (!candidate || !application || application.id !== ownership.applicationId) {
      return {
        success: true as const,
        data: { found: false as const, funnelStep: FUNNEL_STEP_APPLICATION },
      };
    }

    const funnelStep = await deriveFunnelStep(db, candidate.id, application.status);
    return {
      success: true as const,
      data: {
        found: true as const,
        name: candidate.name,
        email: candidate.email,
        applicationStatus: application.status,
        funnelStep,
      },
    };
  } catch (error) {
    console.error('[Get My Application Error]:', error);
    return { success: false as const, error: 'No pudimos recuperar tu postulación.' };
  }
}

/**
 * ACTION: Acknowledge the induction step (ownership-cookie scoped).
 *
 * Advancing 2 -> 3 is validated on the server: the request must prove
 * ownership of an existing application. The transition is idempotent.
 */
export async function acknowledgeInductionAction() {
  try {
    const ownership = await resolveOwnership();
    if (!ownership) {
      return { success: false as const, error: 'Postulación no verificada', code: 'UNAUTHORIZED' as const };
    }
    if (!ownership.applicationId) {
      return { success: false as const, error: 'Postulación no encontrada', code: 'NOT_FOUND' as const };
    }

    const result = await db.$transaction(async (tx) => {
      const application = await tx.recruitmentApplication.findUnique({
        where: { id: ownership.applicationId as string },
        select: { id: true, candidateId: true, status: true, currentStep: true },
      });
      if (!application || application.candidateId !== ownership.candidateId) {
        return { ok: false as const, error: 'Postulación no encontrada', code: 'NOT_FOUND' as const };
      }

      // Already at (or past) the roleplay step: idempotent success.
      const advanced = ['ROLEPLAY_PENDING', 'ROLEPLAY_IN_PROGRESS'];
      if (advanced.includes(application.status) || application.currentStep !== 'APPLICATION') {
        return { ok: true as const };
      }

      await tx.recruitmentApplication.update({
        where: { id: application.id },
        data: {
          status: 'ROLEPLAY_PENDING',
          currentStep: 'ROLEPLAY',
          lastActivityAt: new Date(),
          version: { increment: 1 },
        },
      });
      await tx.recruitmentEvent.create({
        data: {
          applicationId: application.id,
          eventType: 'INDUCTION_COMPLETED',
          fromStatus: application.status,
          toStatus: 'ROLEPLAY_PENDING',
          actorType: 'candidate',
          actorId: String(ownership.candidateId),
        },
      });
      return { ok: true as const };
    });

    if (!result.ok) {
      return { success: false as const, error: result.error, code: result.code };
    }
    revalidatePath('/recruitment');
    return { success: true as const };
  } catch (error) {
    console.error('[Acknowledge Induction Error]:', error);
    return { success: false as const, error: 'No pudimos registrar tu avance.' };
  }
}

/**
 * ACTION: Delete Candidate (admin).
 *
 * Active roleplay sessions are cancelled in the same transaction so a
 * deleted candidate can no longer be resumable/submittable through a stale
 * `roleplay_session` cookie.
 */
export async function deleteCandidate(id: number): Promise<ActionResult> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    await db.$transaction(async (tx) => {
      await tx.roleplaySession.updateMany({
        where: {
          recruitmentCandidateId: id,
          status: { notIn: ['CANCELLED', 'EXPIRED'] },
        },
        data: { status: 'CANCELLED' },
      });
      await tx.recruitmentCandidate.delete({
        where: { id },
        select: { id: true },
      });
    });

    revalidatePath('/recruitment');
    return { success: true };
  } catch (error) {
    console.error('Error in deleteCandidate action:', error);
    return {
      success: false,
      error: 'Failed to delete candidate',
      code: 'INTERNAL_ERROR',
    };
  }
}

/**
 * ACTION: Mark an application as ready for activation (admin).
 *
 * This is the explicit bridge between "recruitment checks complete" and
 * `hireCandidate`, which only accepts READY_FOR_ACTIVATION / HIRING.
 */
export async function markApplicationReadyAction(candidateId: number): Promise<ActionResult> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };
  if (!Number.isSafeInteger(candidateId) || candidateId < 1) {
    return { success: false, error: 'Invalid candidate id', code: 'BAD_REQUEST' };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const candidate = await tx.recruitmentCandidate.findUnique({
        where: { id: candidateId },
        include: { applications: { take: 1 } },
      });
      if (!candidate) {
        return { ok: false as const, error: 'Candidate not found', code: 'NOT_FOUND' as const };
      }
      const application = candidate.applications[0];
      if (!application) {
        return {
          ok: false as const,
          error: 'Candidate has no tracked recruitment application',
          code: 'CONFLICT' as const,
        };
      }
      if (application.status === 'HIRED') {
        return { ok: false as const, error: 'Application already hired', code: 'CONFLICT' as const };
      }
      if (['REJECTED', 'WITHDRAWN', 'EXPIRED'].includes(application.status)) {
        return {
          ok: false as const,
          error: 'Cannot mark a closed application as ready for activation',
          code: 'CONFLICT' as const,
        };
      }
      if (application.status === 'READY_FOR_ACTIVATION' || application.status === 'HIRING') {
        return { ok: true as const, changed: false };
      }

      await tx.recruitmentApplication.update({
        where: { id: application.id },
        data: {
          status: 'READY_FOR_ACTIVATION',
          currentStep: 'READY_FOR_ACTIVATION',
          lastActivityAt: new Date(),
          lastActorId: auth.user.userId,
          version: { increment: 1 },
        },
      });
      await tx.recruitmentEvent.create({
        data: {
          applicationId: application.id,
          eventType: 'READY_FOR_ACTIVATION',
          fromStatus: application.status,
          toStatus: 'READY_FOR_ACTIVATION',
          actorType: 'admin',
          actorId: auth.user.userId,
          metadata: { candidateId: candidate.id },
        },
      });
      return { ok: true as const, changed: true };
    });

    if (!result.ok) {
      return { success: false, error: result.error, code: result.code };
    }
    revalidatePath('/recruitment');
    return { success: true };
  } catch (error) {
    console.error('Error in markApplicationReadyAction:', error);
    return {
      success: false,
      error: 'No se pudo marcar la postulación como lista para contratación.',
      code: 'INTERNAL_ERROR',
    };
  }
}

/**
 * ACTION: Hire Candidate (Convert to Interpreter)
 */
export async function hireCandidate(id: number): Promise<ActionResult> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };
  if (!Number.isSafeInteger(id) || id < 1) {
    return { success: false, error: 'Invalid candidate id', code: 'BAD_REQUEST' };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const candidate = await tx.recruitmentCandidate.findUnique({
        where: { id },
        include: { applications: true },
      });
      if (!candidate) return { ok: false as const, error: 'Candidate not found', code: 'NOT_FOUND' as const };
      const application = candidate.applications[0];
      if (!application) {
        return { ok: false as const, error: 'Candidate has no tracked recruitment application', code: 'CONFLICT' as const };
      }
      if (application.status === 'HIRED' && application.hiredInterpreterId) {
        return { ok: true as const, interpreterId: application.hiredInterpreterId };
      }
      if (!['READY_FOR_ACTIVATION', 'HIRING'].includes(application.status)) {
        return { ok: false as const, error: 'Complete recruitment checks and mark the application ready for activation before hiring.', code: 'CONFLICT' as const };
      }

      const rateConfig = await tx.systemConfig.findUnique({
        where: { key: 'DEFAULT_INTERPRETER_TARIFF_PER_MINUTE' },
        select: { value: true },
      });
      const tariff = rateConfig ? Number(rateConfig.value) : NaN;
      if (!Number.isFinite(tariff) || tariff < 0) {
        return { ok: false as const, error: 'Configure DEFAULT_INTERPRETER_TARIFF_PER_MINUTE in system_configs before hiring.', code: 'SERVICE_UNAVAILABLE' as const };
      }

      const existing = await tx.interpreter.findFirst({
        where: { emailCorporativo: candidate.email },
        select: { id: true },
      });
      if (existing) {
        return { ok: false as const, error: 'An interpreter already uses this candidate email. Review the existing record before continuing.', code: 'CONFLICT' as const };
      }

      const interpreter = await tx.interpreter.create({
        data: {
          externalId: `recruitment-candidate-${candidate.id}`,
          name: candidate.name,
          status: 'Activo',
          emailCorporativo: candidate.email,
          telefono: candidate.telefono,
          pais: candidate.pais,
          tariffPerMinute: tariff,
          notas: JSON.stringify({
            recruitmentCandidateId: candidate.id,
            englishLevel: candidate.englishLevel,
            speedtestMbps: candidate.speedtestMbps,
            source: 'recruitment',
          }),
        },
        select: { id: true },
      });

      await tx.recruitmentApplication.update({
        where: { id: application.id },
        data: {
          status: 'HIRED',
          currentStep: 'HIRING',
          hiredInterpreterId: interpreter.id,
          completedAt: new Date(),
          lastActivityAt: new Date(),
          lastActorId: auth.user.userId,
          version: { increment: 1 },
        },
      });
      await tx.recruitmentCandidate.update({
        where: { id: candidate.id },
        data: { status: 'Contratado', fechaInicio: new Date() },
      });
      await tx.recruitmentEvent.create({
        data: {
          applicationId: application.id,
          eventType: 'HIRED',
          fromStatus: application.status,
          toStatus: 'HIRED',
          actorType: 'admin',
          actorId: auth.user.userId,
          metadata: { interpreterId: interpreter.id, candidateId: candidate.id },
        },
      });
      return { ok: true as const, interpreterId: interpreter.id };
    });

    if (!result.ok) {
      return { success: false, error: result.error, code: result.code };
    }
    revalidatePath('/recruitment');
    revalidatePath('/dashboard');
    revalidatePath('/interpreters');
    return { success: true };
  } catch (error) {
    console.error('Error in hireCandidate action:', error);
    return {
      success: false,
      error: 'No se pudo completar la contratación. Revisa la configuración y los registros del servidor.',
      code: 'INTERNAL_ERROR',
    };
  }
}
