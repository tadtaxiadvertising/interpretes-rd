'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ActionResult } from '@/lib/types';
import { validateAction } from '@/lib/auth/actions';
import { ApplicantSchema, ApplicantData } from '@/lib/validators/recruitment';

const db = prisma;

/**
 * ACTION: Submit Application (Public - no auth required)
 * Inserts a new candidate into the recruitment funnel with status "Aplicante"
 */
export async function submitApplicationAction(data: ApplicantData) {
  try {
    // 1. Strict Zod validation
    const parsed = ApplicantSchema.parse(data);

    // 2. Database operation using Singleton (Transaction Pooler - port 6543)
    // Insert into funnel as "Aplicante" initial status
    const candidate = await db.$transaction(async (tx) => {
      const created = await tx.recruitmentCandidate.create({
        data: {
          name: parsed.name,
          email: parsed.email,
          telefono: parsed.phone,
          pais: parsed.country,
          englishLevel: parsed.englishLevel,
          speedtestMbps: parsed.speedtestMbps,
          notas: JSON.stringify({
            efsetLink: parsed.efsetLink,
            ...(parsed.cvUrl ? { cvUrl: parsed.cvUrl } : {}),
          }),
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
          actorId: parsed.email,
          metadata: { source: 'Web Portal' },
        },
      });
      return { id: created.id, applicationId: application.id };
    });

    revalidatePath('/admin/recruitment');
    return { success: true, candidateId: candidate.id, applicationId: candidate.applicationId };
    
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
 * ACTION: Delete Candidate
 */
export async function deleteCandidate(id: number): Promise<ActionResult> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    await db.recruitmentCandidate.delete({
      where: { id },
      select: { id: true }
    });

    revalidatePath('/admin/recruitment');
    return { success: true };
  } catch (error) {
    console.error('Error in deleteCandidate action:', error);
    return { 
      success: false, 
      error: 'Failed to delete candidate',
      code: 'INTERNAL_ERROR'
    };
  }
}

/**
 * ACTION: Hire Candidate (Convert to Interpreter)
 * Placeholder for actual hiring logic
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
          lastActorId: auth.user.id,
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
          actorId: auth.user.id,
          metadata: { interpreterId: interpreter.id, candidateId: candidate.id },
        },
      });
      return { ok: true as const, interpreterId: interpreter.id };
    });

    if (!result.ok) {
      return { success: false, error: result.error, code: result.code };
    }
    revalidatePath('/admin/recruitment');
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/interpreters');
    return { success: true, data: { interpreterId: result.interpreterId } };
  } catch (error) {
    console.error('Error in hireCandidate action:', error);
    return {
      success: false,
      error: 'No se pudo completar la contratación. Revisa la configuración y los registros del servidor.',
      code: 'INTERNAL_ERROR',
    };
  }
}
