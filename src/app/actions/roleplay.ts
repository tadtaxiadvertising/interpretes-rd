'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import { revalidatePath } from 'next/cache';
import { createSignedUploadUrl, getBaseAudioPath, getResponseAudioPath, confirmUpload, validateAudioMetadata } from '@/lib/roleplay';
import { createNotification } from './notifications';
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import { cookies } from 'next/headers';
import type { RecruitmentApplicationStatus, RecruitmentStep, RecruitmentEventType } from '@/lib/prisma-types';
import { calculateRoleplayScore } from '@/lib/roleplay/scoring';
import { advanceApplication } from '@/services/recruitment/transitions';
import { queueMp3Conversion } from '@/lib/roleplay-audio-conversion';

const db = prisma;

async function canAccessRoleplaySession(
  session: { interpreterId: number | null; recruitmentCandidateId: number | null; id: string },
  sessionCookie: string | null
): Promise<boolean> {
  const identity = await resolveCurrentIdentity();
  if (!identity) return false;

  // A recruitment-linked session is candidate-owned even if legacy data
  // still contains a provisional interpreterId. Never fall through to
  // interpreter ownership for a session attached to a candidate.
  if (session.recruitmentCandidateId !== null) {
    return identity.role === 'candidate'
      && identity.candidateId === session.recruitmentCandidateId
      && sessionCookie === session.id;
  }

  return session.interpreterId !== null
    && identity.role === 'interpreter'
    && identity.interpreterId === session.interpreterId;
}

function isUniqueConstraintConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'P2002';
}

const CreateRoleplaySessionSchema = z.object({
  interpreterId: z.number().int().positive().optional(),
  recruitmentCandidateId: z.number().int().positive().optional(),
  baseAudioMimeType: z.string(),
  baseAudioSize: z.number().int().positive().max(15 * 1024 * 1024),
});

export type CreateRoleplaySessionInput = z.infer<typeof CreateRoleplaySessionSchema>;

export async function createRoleplaySession(rawInput: CreateRoleplaySessionInput) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parseResult = CreateRoleplaySessionSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;

  if (!input.interpreterId && !input.recruitmentCandidateId) {
    return { success: false, error: 'Must assign to either interpreter or candidate', code: 'VALIDATION_ERROR' };
  }
  if (input.interpreterId && input.recruitmentCandidateId) {
    return { success: false, error: 'Cannot assign to both interpreter and candidate', code: 'VALIDATION_ERROR' };
  }

  const validation = validateAudioMetadata(input.baseAudioMimeType, input.baseAudioSize);
  if (!validation.valid || !validation.extension) {
    return { success: false, error: validation.error, code: 'VALIDATION_ERROR' };
  }

  try {
    const session = await db.roleplaySession.create({
      data: {
        interpreterId: input.interpreterId ?? null,
        recruitmentCandidateId: input.recruitmentCandidateId ?? null,
        baseAudioUrl: getBaseAudioPath('', validation.extension), // placeholder, will update after upload
        status: 'DRAFT',
      },
      select: { id: true },
    });

    const baseAudioPath = getBaseAudioPath(session.id, validation.extension);
    
    await db.roleplaySession.update({
      where: { id: session.id },
      data: { baseAudioUrl: baseAudioPath },
    });

    const uploadResult = await createSignedUploadUrl(session.id, input.baseAudioMimeType, true);

    if (input.recruitmentCandidateId) {
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await db.roleplayAccess.create({
        data: {
          sessionId: session.id,
          tokenHash,
          expiresAt,
        },
      });

      return { 
        success: true, 
        data: { 
          sessionId: session.id,
          uploadUrl: uploadResult.uploadUrl,
          uploadPath: uploadResult.path,
          inviteToken: rawToken,
        } 
      };
    }

    return { 
      success: true, 
      data: { 
        sessionId: session.id,
        uploadUrl: uploadResult.uploadUrl,
        uploadPath: uploadResult.path,
      } 
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Create Roleplay Session Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}

export async function confirmBaseAudioUpload(sessionId: string, uploadPath: string) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    if (!sessionId || sessionId.length > 100 || !uploadPath || uploadPath.length > 300) {
      return { success: false, error: 'Ruta de audio base inválida', code: 'VALIDATION_ERROR' };
    }

    // Bind confirmation to the exact session and canonical base-audio object.
    // Never sign an arbitrary bucket path supplied by the caller.
    const session = await db.roleplaySession.findUnique({
      where: { id: sessionId },
      select: { id: true, baseAudioUrl: true },
    });
    if (!session) {
      return { success: false, error: 'Sesión de roleplay no encontrada', code: 'NOT_FOUND' };
    }

    const isCanonicalPath =
      /^base\/[A-Za-z0-9_-]+\.(webm|mp4|ogg|mp3)$/.test(uploadPath) &&
      uploadPath.startsWith(`base/${sessionId}.`) &&
      session.baseAudioUrl === uploadPath;
    if (!isCanonicalPath) {
      return { success: false, error: 'La ruta de audio no corresponde a esta sesión', code: 'VALIDATION_ERROR' };
    }

    const signedUrl = await confirmUpload(uploadPath);
    // Compare-and-set prevents a second confirmation from replacing an already
    // confirmed URL or racing with another update.
    const updated = await db.roleplaySession.updateMany({
      where: { id: sessionId, baseAudioUrl: uploadPath },
      data: { baseAudioUrl: signedUrl },
    });
    if (updated.count !== 1) {
      return { success: false, error: 'El audio base ya fue confirmado o cambió durante la operación', code: 'CONFLICT' };
    }

    revalidatePath('/admin/roleplays');
    return { success: true, data: { baseAudioUrl: signedUrl } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Confirm Base Audio Error:', message);
    return { success: false, error: 'No se pudo confirmar el audio base', code: 'INTERNAL_ERROR' };
  }
}

const RESUME_EXCLUDED_STATUSES = ['CANCELLED', 'EXPIRED'] as const;

type ApplicationAdvance = {
  candidateId: number;
  fromStatuses: RecruitmentApplicationStatus[];
  toStatus: RecruitmentApplicationStatus;
  toStep: RecruitmentStep;
  eventType: RecruitmentEventType;
  actorType: 'candidate' | 'admin' | 'system';
  actorId: string;
};

/**
 * Advances the candidate's recruitment application through the hiring
 * pipeline when a roleplay milestone happens (start, submit, evaluation).
 *
 * Delegates to the canonical state machine in
 * `@/services/recruitment/transitions` (optimistic `status`+`version` guard,
 * RecruitmentEvent audit), so a retried or concurrent action can never
 * double-advance or regress the application: the database is the authority.
 * Bookkeeping is best-effort — a pipeline write failure is logged and never
 * fails the roleplay action itself (the roleplay state remains correct).
 */
async function advanceApplicationPipeline(advance: ApplicationAdvance): Promise<void> {
  try {
    await advanceApplication({
      candidateId: advance.candidateId,
      fromStatuses: advance.fromStatuses,
      toStatus: advance.toStatus,
      toStep: advance.toStep,
      eventType: advance.eventType,
      actorType: advance.actorType,
      actorId: advance.actorId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Application pipeline advance failed (ignored):', message);
  }
}

/**
 * Start (or resume) the roleplay session for the currently authenticated
 * recruitment candidate. This is the candidate-facing entry point used by the
 * /postular funnel: it binds the request to the candidate identity (via the
 * account email), reuses an admin-assigned session instead of creating
 * placeholder exercises, verifies every scenario has base audio, and issues
 * the `roleplay_session` cookie required by candidate-facing submit paths.
 */
export async function startCandidateRoleplay() {
  const auth = await validateAction();
  if ('error' in auth) {
    return { success: false as const, error: auth.error, code: auth.code, requiresAuth: true as const };
  }

  const email = auth.user.email?.toLowerCase().trim();
  if (!email) {
    return { success: false as const, error: 'Account has no email', code: 'VALIDATION_ERROR' as const };
  }

  // Server-side eligibility is authoritative; callers can invoke this action
  // directly without visiting the client-side onboarding gate.
  const identity = await resolveCurrentIdentity();
  if (
    !identity ||
    identity.role !== 'candidate' ||
    !identity.candidateId ||
    identity.email?.toLowerCase().trim() !== email
  ) {
    return { success: false as const, error: 'Access denied', code: 'UNAUTHORIZED' as const };
  }

  try {
    const candidate = await db.recruitmentCandidate.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!candidate) {
      return { success: false as const, error: 'No application found for this account', code: 'NOT_FOUND' as const };
    }

    const application = await db.recruitmentApplication.findFirst({
      where: { candidateId: candidate.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    const startableApplicationStatuses: readonly string[] = [
      'ROLEPLAY_PENDING',
      'ROLEPLAY_IN_PROGRESS',
      'ROLEPLAY_REVIEW',
    ];
    if (!application || !startableApplicationStatuses.includes(application.status)) {
      return {
        success: false as const,
        error: 'Tu postulación no está habilitada para iniciar un roleplay en esta etapa.',
        code: 'CONFLICT' as const,
      };
    }

    // Reuse only an actual admin-assigned exercise. Never fabricate a blank
    // scenario: without a base recording there is no valid selection exercise.
    const previousSession = await db.roleplaySession.findFirst({
      where: {
        recruitmentCandidateId: candidate.id,
        status: { notIn: [...RESUME_EXCLUDED_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        baseAudioUrl: true,
        scenarios: {
          orderBy: { order: 'asc' },
          select: {
            order: true,
            title: true,
            baseAudioUrl: true,
            durationLimitSec: true,
            scriptPrompt: true,
            expectedKeys: true,
          },
        },
      },
    });

    if (!previousSession) {
      return {
        success: false as const,
        error: 'Todavía no tienes un ejercicio de Roleplay asignado. El equipo de reclutamiento debe asignar los escenarios antes de que puedas comenzar.',
        code: 'CONFLICT' as const,
      };
    }

    if (
      previousSession.scenarios.length === 0 ||
      previousSession.scenarios.some((scenario) => !scenario.baseAudioUrl?.trim())
    ) {
      return {
        success: false as const,
        error: 'Tu ejercicio de Roleplay está incompleto: falta asignar el audio base de uno o más escenarios. Contacta al equipo de reclutamiento.',
        code: 'CONFLICT' as const,
      };
    }

    // A reviewed attempt may be retried only after QA releases it. Validate the
    // prior assignment first so a failed retry cannot regress the application.
    const retryingFromReview = application.status === 'ROLEPLAY_REVIEW';
    if (retryingFromReview && previousSession.status === 'UNDER_REVIEW') {
      return {
        success: false as const,
        error: 'Tu roleplay todavía está siendo evaluado. Espera el resultado antes de reintentarlo.',
        code: 'CONFLICT' as const,
      };
    }

    if (retryingFromReview) {
      const retryTransition = await advanceApplication({
        applicationId: application.id,
        fromStatuses: ['ROLEPLAY_REVIEW'],
        toStatus: 'ROLEPLAY_PENDING',
        toStep: 'ROLEPLAY',
        eventType: 'ROLEPLAY_CREATED',
        actorType: 'candidate',
        actorId: String(candidate.id),
        metadata: { retry: true },
      });
      if (!retryTransition.success) {
        return {
          success: false as const,
          error: 'No se pudo habilitar el reintento de Roleplay. Inténtalo de nuevo.',
          code: 'CONFLICT' as const,
        };
      }
    }

    // A reviewed attempt is historical evidence. Retrying creates a fresh
    // session with the same scenario definitions, never prior responses or QA.
    const shouldCreateRetry = retryingFromReview &&
      ['SUBMITTED', 'EVALUATED', 'PASSED', 'FAILED'].includes(previousSession.status);

    let session;
    if (shouldCreateRetry) {
      session = await db.roleplaySession.create({
        data: {
          recruitmentCandidateId: candidate.id,
          baseAudioUrl: previousSession.baseAudioUrl,
          status: 'STARTED',
          scenarios: {
            create: previousSession.scenarios.map((scenario) => ({
              order: scenario.order,
              title: scenario.title,
              baseAudioUrl: scenario.baseAudioUrl,
              durationLimitSec: scenario.durationLimitSec,
              scriptPrompt: scenario.scriptPrompt,
              expectedKeys: scenario.expectedKeys,
            })),
          },
        },
        select: { id: true, status: true },
      });
    } else {
      session = { id: previousSession.id, status: previousSession.status };
      if (['DRAFT', 'INVITED'].includes(session.status)) {
        const transition = await db.roleplaySession.updateMany({
          where: { id: session.id, status: session.status },
          data: { status: 'STARTED' },
        });

        if (transition.count === 0) {
          const latest = await db.roleplaySession.findUnique({
            where: { id: session.id },
            select: { id: true, status: true },
          });

          if (!latest || !['STARTED', 'IN_PROGRESS'].includes(latest.status)) {
            return {
              success: false as const,
              error: 'La sesión de roleplay ya no está disponible. Actualiza la página para continuar.',
              code: 'CONFLICT' as const,
            };
          }

          session = { id: latest.id, status: latest.status };
        } else {
          session = { id: session.id, status: 'STARTED' };
        }
      }
    }

    await db.roleplayAccess.upsert({
      where: { sessionId: session.id },
      update: { validatedAt: new Date() },
      create: {
        sessionId: session.id,
        tokenHash: `candidate:${session.id}:${randomBytes(16).toString('hex')}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        validatedAt: new Date(),
      },
    });

    (await cookies()).set('roleplay_session', session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    // Pipeline bookkeeping: the roleplay is now in progress for this
    // candidate. Guarded + best-effort (see advanceApplicationPipeline).
    await advanceApplicationPipeline({
      candidateId: candidate.id,
      fromStatuses: ['APPLIED', 'INDUCTION_PENDING', 'ROLEPLAY_PENDING'],
      toStatus: 'ROLEPLAY_IN_PROGRESS',
      toStep: 'ROLEPLAY',
      eventType: 'ROLEPLAY_STARTED',
      actorType: 'candidate',
      actorId: String(candidate.id),
    });

    revalidatePath('/dashboard/roleplays');
    return { success: true as const, data: { sessionId: session.id } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Start Candidate Roleplay Error:', message);
    return { success: false as const, error: message, code: 'INTERNAL_ERROR' as const };
  }
}

const SubmitResponseSchema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1).optional(),
});

export type SubmitResponseInput = z.infer<typeof SubmitResponseSchema>;

export async function submitRoleplayResponse(rawInput: SubmitResponseInput) {
  const auth = await validateAction();
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parseResult = SubmitResponseSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;

  try {
    const session = await db.roleplaySession.findUnique({
      where: { id: input.sessionId },
      select: {
        id: true,
        interpreterId: true,
        recruitmentCandidateId: true,
        status: true,
        currentScenarioIndex: true,
      },
    });

    if (!session) {
      return { success: false, error: 'Session not found', code: 'NOT_FOUND' };
    }

    if (!['INVITED', 'STARTED', 'IN_PROGRESS'].includes(session.status)) {
      return { success: false, error: 'Session is not in a state that allows submitting responses', code: 'INVALID_STATE' };
    }

    const sessionCookie = (await cookies()).get('roleplay_session')?.value ?? null;
    if (!(await canAccessRoleplaySession(session, sessionCookie))) {
      return { success: false, error: 'Unauthorized', code: 'FORBIDDEN' };
    }

    // Resolve the real database scenario ID from the persisted cursor. Synthetic
    // values such as "scenario_0" cannot be uploaded or confirmed against Prisma.
    const expectedScenario = await db.roleplayScenario.findFirst({
      where: { sessionId: session.id, order: session.currentScenarioIndex },
      select: { id: true },
    });
    if (!expectedScenario) {
      return { success: false, error: 'No scenario is available at the current step', code: 'NOT_FOUND' };
    }
    if (input.scenarioId && input.scenarioId !== expectedScenario.id) {
      return { success: false, error: 'Escenario no disponible', code: 'FORBIDDEN' };
    }

    const existingResponse = await db.roleplayResponse.findFirst({
      where: { scenarioId: expectedScenario.id },
      select: { id: true },
    });
    if (existingResponse) {
      return { success: false, error: 'Response already submitted for this scenario', code: 'ALREADY_SUBMITTED' };
    }

    return {
      success: true,
      data: {
        sessionId: session.id,
        scenarioId: expectedScenario.id,
        convertApiUrl: '/api/roleplay/convert-audio',
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Submit Response Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}

const ConfirmResponseSchema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1),
  recordedAudioUrl: z.string().min(1),
  sourceAudioPath: z.string().min(1).max(1024),
  processedAudioPath: z.string().min(1).max(1024).optional(),
  durationSec: z.number().int().min(0).max(86400).optional(),
}).strict();

export type ConfirmResponseInput = z.infer<typeof ConfirmResponseSchema>;

function isCanonicalResponseAudioPath(path: string, sessionId: string, scenarioId: string): boolean {
  const match = path.match(/^responses\/([^/]+)\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(webm|mp4|ogg|mp3)$/i);
  return !!match && match[1] === sessionId && match[2] === scenarioId;
}


export async function confirmRoleplayResponse(rawInput: ConfirmResponseInput) {
  // Recruitment candidates perform this step before interpreter activation.
  const auth = await validateAction(['interpreter', 'candidate']);
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parseResult = ConfirmResponseSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;

  if (input.sourceAudioPath && (!input.scenarioId || !isCanonicalResponseAudioPath(input.sourceAudioPath, input.sessionId, input.scenarioId))) {
    return { success: false, error: 'Invalid response audio path', code: 'VALIDATION_ERROR' };
  }
  if (input.processedAudioPath && (!input.scenarioId || !isCanonicalResponseAudioPath(input.processedAudioPath, input.sessionId, input.scenarioId))) {
    return { success: false, error: 'Invalid response audio path', code: 'VALIDATION_ERROR' };
  }

  const sessionCookie = (await cookies()).get('roleplay_session')?.value ?? null;

  try {
    const result = await db.$transaction(async (tx) => {
      const session = await tx.roleplaySession.findUnique({
        where: { id: input.sessionId },
        select: { 
          id: true, 
          recordedAudioUrl: true, 
          interpreterId: true, 
          recruitmentCandidateId: true, 
          status: true,
          currentScenarioIndex: true,
        },
      });

      if (!session) {
        throw new Error('Session not available for submission');
      }

      // Interpreter sessions are bound to the resolved interpreter id.
      // Candidate sessions are bound to the opaque, server-issued
      // roleplay_session cookie created by the invite/start flow: an
      // authenticated user alone is not sufficient.
      if (!(await canAccessRoleplaySession(session, sessionCookie))) {
        throw new Error('Unauthorized');
      }
      // A response must belong to a real scenario in this session. Without this check a
      // caller could read or overwrite another session's response by passing
      // a foreign scenario id (cross-session write).
      const scenario = await tx.roleplayScenario.findFirst({
        where: { id: input.scenarioId, sessionId: session.id },
        select: { id: true },
      });
      if (!scenario) throw new Error('Unauthorized');
      if (!isCanonicalResponseAudioPath(input.sourceAudioPath, session.id, input.scenarioId)) {
        throw new Error('A valid uploaded audio object is required before confirming the response');
      }

      // A retried confirm after a successful commit may arrive after the
      // session index has advanced. Treat only the exact same stored audio
      // as an idempotent replay; never overwrite a confirmed response.
      const priorResponse = await tx.roleplayResponse.findFirst({
        where: { scenarioId: input.scenarioId },
        select: { id: true, sourceAudioUrl: true, sourceAudioPath: true, processedAudioPath: true },
      });
      if (priorResponse) {
        if (priorResponse.sourceAudioPath === input.sourceAudioPath) {
          return {
            recordedAudioUrl: priorResponse.sourceAudioUrl ?? input.recordedAudioUrl,
            submitted: session.status === 'SUBMITTED',
            candidateId: session.recruitmentCandidateId,
            sourceAudioPath: priorResponse.sourceAudioPath,
            processedAudioPath: priorResponse.processedAudioPath,
            newlyCreated: false,
          };
        }
        throw new Error('Response already recorded for this scenario');
      }

      // Sequential binding: a new response must target the scenario expected
      // at the session's current index, so a candidate cannot skip steps.
      const nextScenario = await tx.roleplayScenario.findFirst({
        where: { sessionId: session.id, order: session.currentScenarioIndex },
        select: { id: true },
      });
      if (!nextScenario || nextScenario.id !== input.scenarioId) {
        throw new Error('Unauthorized');
      }

      const validSubmitStates = ['INVITED', 'STARTED', 'IN_PROGRESS'];
      const canSubmit = validSubmitStates.includes(session.status);

      if (!canSubmit) {
        throw new Error('Session not available for submission');
      }

      // Sign the uploaded object server-side. Never trust a client-supplied URL
      // as proof that an audio recording exists in the roleplay bucket.
      const confirmedAudioUrl = await confirmUpload(input.sourceAudioPath);

      // Persist a new response only once. The existing-response path above
      // handles idempotent retries before the sequential-index check.
      await tx.roleplayResponse.create({
        data: {
          scenarioId: input.scenarioId,
          sourceAudioUrl: confirmedAudioUrl,
          sourceAudioPath: input.sourceAudioPath,
          processedAudioPath: input.processedAudioPath ?? null,
          durationSec: input.durationSec ?? null,
          // Self-assessment is saved only by saveSelfAssessment after the
          // recording is confirmed; audio confirmation cannot carry scores.
          audioStatus: input.sourceAudioPath.endsWith('.webm') ? 'UPLOADED' : 'READY',
          submittedAt: new Date(),
        },
      });

      const updated = await tx.roleplaySession.update({
        where: { id: input.sessionId },
        data: {
          recordedAudioUrl: confirmedAudioUrl,
          // Audio confirmation never advances the cursor or submits the session.
          status: 'IN_PROGRESS',
        },
        select: { id: true },
      });
      if (!updated) throw new Error('Concurrent submission detected');

      return {
        recordedAudioUrl: confirmedAudioUrl,
        submitted: false,
        candidateId: session.recruitmentCandidateId,
        sourceAudioPath: input.sourceAudioPath,
        processedAudioPath: input.processedAudioPath ?? null,
        newlyCreated: true,
      };
    });

    // Convert only after the response row commits, and scope conversion to this
    // exact upload attempt. This prevents a stale upload/conversion from changing
    // the processed audio associated with the response QA will evaluate.
    if (result.newlyCreated && result.sourceAudioPath?.endsWith('.webm')) {
      queueMp3Conversion(input.sessionId, input.scenarioId, result.sourceAudioPath);
    }

    // Recruitment advances only after the explicit final submission action,
    // which verifies every scenario has both audio and self-assessment.

    revalidatePath('/dashboard/roleplays');
    revalidatePath('/admin/roleplays');
    return { success: true, data: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Confirm Response Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}

const SelfAssessmentSchema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1),
  scores: z.object({
    protocol: z.number().min(0).max(10),
    interpretation: z.number().min(0).max(10),
    language: z.number().min(0).max(10),
    service: z.number().min(0).max(10),
    technical: z.number().min(0).max(10),
  }).strict(),
  criticalError: z.boolean(),
  notes: z.string().max(2000).optional(),
});

export type SelfAssessmentInput = z.infer<typeof SelfAssessmentSchema>;

export async function saveSelfAssessment(rawInput: SelfAssessmentInput) {
  // Candidate self-assessment is a recruitment stage and precedes interpreter activation.
  const auth = await validateAction(['interpreter', 'candidate']);
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parseResult = SelfAssessmentSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid self-assessment', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;
  const sessionCookie = (await cookies()).get('roleplay_session')?.value ?? null;

  try {
    await db.$transaction(async (tx) => {
      const session = await tx.roleplaySession.findUnique({
        where: { id: input.sessionId },
        select: {
          id: true,
          interpreterId: true,
          recruitmentCandidateId: true,
          status: true,
          currentScenarioIndex: true,
          evaluatorId: true,
          qaScoreId: true,
        },
      });

      const isLegacyUnclaimedSubmission = session?.status === 'SUBMITTED'
        && session.evaluatorId === null
        && session.qaScoreId === null;
      if (!session || (!['STARTED', 'IN_PROGRESS'].includes(session.status) && !isLegacyUnclaimedSubmission)) {
        throw new Error('Session not available for self-assessment');
      }
      if (!(await canAccessRoleplaySession(session, sessionCookie))) throw new Error('Unauthorized');

      const scenario = await tx.roleplayScenario.findFirst({
        where: { id: input.scenarioId, sessionId: session.id },
        select: { id: true, order: true },
      });
      if (!scenario || (isLegacyUnclaimedSubmission
        ? scenario.order >= session.currentScenarioIndex
        : scenario.order !== session.currentScenarioIndex)) {
        throw new Error('This scenario is not the current step');
      }

      const response = await tx.roleplayResponse.findFirst({
        where: { scenarioId: input.scenarioId },
        select: { id: true, sourceAudioUrl: true, selfScore: true },
      });
      if (!response?.sourceAudioUrl) {
        throw new Error('Confirm your recording before completing the self-assessment');
      }
      const existingScore = response.selfScore;
      const existingScoreIsComplete = Boolean(
        existingScore &&
        typeof existingScore === 'object' &&
        !Array.isArray(existingScore) &&
        ['protocol', 'interpretation', 'language', 'service', 'technical']
          .every((key) => typeof (existingScore as Record<string, unknown>)[key] === 'number')
      );
      if (isLegacyUnclaimedSubmission && existingScoreIsComplete) {
        throw new Error('This self-assessment has already been submitted');
      }

      await tx.roleplayResponse.update({
        where: { id: response.id },
        data: {
          selfScore: { ...input.scores, criticalError: input.criticalError },
          selfNotes: input.notes ?? null,
        },
      });

      // Persist the workflow cursor only after both recording and self-assessment
      // have been stored. Refreshing the page therefore resumes at the right stage.
      // Old clients could mark the session SUBMITTED immediately after the
      // final recording. Permit only unclaimed legacy submissions to fill in
      // missing self-assessments, without reopening or moving the submitted cursor.
      if (!isLegacyUnclaimedSubmission) {
        await tx.roleplaySession.update({
          where: { id: session.id },
          data: { currentScenarioIndex: scenario.order + 1, status: 'IN_PROGRESS' },
        });
      }
    });

    revalidatePath('/dashboard/roleplays');
    revalidatePath('/admin/roleplays');
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Save Self Assessment Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}

const SubmitRoleplaySessionSchema = z.object({
  sessionId: z.string().min(1),
});

export async function submitRoleplaySession(rawInput: { sessionId: string }) {
  const auth = await validateAction(['interpreter', 'candidate']);
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parsed = SubmitRoleplaySessionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'Invalid session', code: 'VALIDATION_ERROR' };
  const { sessionId } = parsed.data;
  const sessionCookie = (await cookies()).get('roleplay_session')?.value ?? null;

  try {
    const candidateId = await db.$transaction(async (tx) => {
      const session = await tx.roleplaySession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          interpreterId: true,
          recruitmentCandidateId: true,
          status: true,
          currentScenarioIndex: true,
          evaluatorId: true,
          qaScoreId: true,
        },
      });
      const isLegacyUnclaimedSubmission = session?.status === 'SUBMITTED'
        && session.evaluatorId === null
        && session.qaScoreId === null;
      if (!session || (!['STARTED', 'IN_PROGRESS'].includes(session.status) && !isLegacyUnclaimedSubmission)) {
        throw new Error('Roleplay is not ready to submit');
      }
      if (!(await canAccessRoleplaySession(session, sessionCookie))) throw new Error('Unauthorized');

      const scenarios = await tx.roleplayScenario.findMany({
        where: { sessionId },
        orderBy: { order: 'asc' },
        select: {
          order: true,
          responses: { select: { sourceAudioUrl: true, selfScore: true } },
        },
      });
      const hasCompleteAssessments = scenarios.length > 0 &&
        scenarios.every((scenario) => {
          const response = scenario.responses[0];
          const score = response?.selfScore;
          if (!response?.sourceAudioUrl || !score || typeof score !== 'object' || Array.isArray(score)) return false;
          return ['protocol', 'interpretation', 'language', 'service', 'technical']
            .every((key) => typeof (score as Record<string, unknown>)[key] === 'number');
        });

      if (!hasCompleteAssessments || session.currentScenarioIndex !== scenarios.length) {
        throw new Error('Complete every recording and self-assessment before submitting');
      }

      if (!isLegacyUnclaimedSubmission) {
        const transition = await tx.roleplaySession.updateMany({
          where: {
            id: sessionId,
            status: { in: ['STARTED', 'IN_PROGRESS'] },
            currentScenarioIndex: scenarios.length,
          },
          data: { status: 'SUBMITTED', submittedAt: new Date() },
        });
        if (transition.count !== 1) throw new Error('Roleplay was already submitted or changed');
      }

      if (session.recruitmentCandidateId) {
        await tx.roleplayAccess.updateMany({
          where: { sessionId, usedAt: null },
          data: { usedAt: new Date() },
        });
      }
      return session.recruitmentCandidateId;
    });

    if (candidateId) {
      await advanceApplicationPipeline({
        candidateId,
        fromStatuses: ['ROLEPLAY_PENDING', 'ROLEPLAY_IN_PROGRESS'],
        toStatus: 'ROLEPLAY_REVIEW',
        toStep: 'ROLEPLAY_REVIEW',
        eventType: 'ROLEPLAY_SUBMITTED',
        actorType: 'candidate',
        actorId: String(candidateId),
      });
    }

    revalidatePath('/dashboard/roleplays');
    revalidatePath('/admin/roleplays');
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Submit Roleplay Session Error:', message);
    return { success: false, error: message, code: 'CONFLICT' };
  }
}

async function deleteAudio(path: string) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    await supabaseAdmin.storage.from('roleplay-audio').remove([path]);
  } catch {}
}

const ValidateInviteTokenSchema = z.object({
  token: z.string().min(1),
});

export type ValidateInviteTokenInput = z.infer<typeof ValidateInviteTokenSchema>;

export async function validateInviteToken(rawInput: ValidateInviteTokenInput) {
  const parseResult = ValidateInviteTokenSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid token', code: 'VALIDATION_ERROR' };
  const { token } = parseResult.data;

  const tokenHash = createHash('sha256').update(token).digest('hex');

  try {
    const access = await db.roleplayAccess.findFirst({
      where: { tokenHash },
      include: { session: true },
    });

    if (!access) {
      return { success: false, error: 'Invalid or expired invitation', code: 'INVALID_TOKEN' };
    }

    if (access.usedAt) {
      return { success: false, error: 'Invitation already used', code: 'TOKEN_USED' };
    }

    if (access.expiresAt < new Date()) {
      return { success: false, error: 'Invitation expired', code: 'TOKEN_EXPIRED' };
    }

    const validInviteStates = ['DRAFT', 'INVITED'];
    if (!validInviteStates.includes(access.session.status)) {
      return { success: false, error: 'Session no longer available', code: 'INVALID_STATE' };
    }

    // Validate only - do NOT consume token
    // Token will be consumed when user actually starts the roleplay
    const cookieStore = await cookies();
    cookieStore.set('roleplay_session', access.session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
      path: '/',
    });

    return { 
      success: true, 
      data: { 
        sessionId: access.session.id,
        baseAudioUrl: access.session.baseAudioUrl,
        candidateName: access.session.recruitmentCandidateId ? 'Candidate' : undefined,
      } 
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Validate Invite Token Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}

const EvaluateRoleplaySchema = z.object({
  sessionId: z.string().min(1),
  protocolScore: z.number().min(0).max(10),
  interpretationScore: z.number().min(0).max(10),
  languageScore: z.number().min(0).max(10),
  serviceScore: z.number().min(0).max(10),
  technicalScore: z.number().min(0).max(10),
  criticalError: z.boolean(),
  comments: z.string().max(5000).optional(),
});

export type EvaluateRoleplayInput = z.infer<typeof EvaluateRoleplaySchema>;

export async function evaluateRoleplay(_prevState: any, formData: FormData) {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  // Parse dimension scores strictly: 0 is valid, but missing/blank or
  // malformed values must not silently become a real score of zero.
  const readScore = (key: string): number => {
    const value = formData.get(key);
    if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
    return Number(value);
  };
  const rawInput = {
    sessionId: formData.get('sessionId') as string,
    protocolScore: readScore('protocolScore'),
    interpretationScore: readScore('interpretationScore'),
    languageScore: readScore('languageScore'),
    serviceScore: readScore('serviceScore'),
    technicalScore: readScore('technicalScore'),
    criticalError: formData.get('criticalError') === 'on',
    comments: formData.get('comments') as string || '',
  };

  const parseResult = EvaluateRoleplaySchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;

  // Canonical scoring: 0..10 dimensions in, 0..100 total out; criticalError
  // forces 0. All consumers share this single function (lib/roleplay/scoring).
  const score = calculateRoleplayScore({
    protocol: input.protocolScore,
    interpretation: input.interpretationScore,
    language: input.languageScore,
    service: input.serviceScore,
    technical: input.technicalScore,
    criticalError: input.criticalError,
  });
  const totalScore = score.totalScore;
  const actionRequired = score.actionRequired;

  const auditorEmail = auth.user.email || 'System';

  try {
    const result = await db.$transaction(async (tx) => {
      const session = await tx.roleplaySession.findUnique({
        where: { id: input.sessionId },
        select: { 
          id: true, 
          qaScoreId: true, 
          recordedAudioUrl: true, 
          recruitmentCandidateId: true,
          interpreterId: true,
          status: true,
        },
      });

      if (!session) throw new Error('Session not found');
      if (session.qaScoreId) throw new Error('Session already evaluated');
      if (!session.recordedAudioUrl) throw new Error('No response submitted yet');

      // Atomic claim: exactly one evaluator wins. Guarded by
      // status = SUBMITTED AND evaluatorId IS NULL; the claim also moves the
      // session into UNDER_REVIEW (plan §32/§33). A concurrent request updates
      // zero rows and is rejected as a conflict.
      const claimed = await tx.roleplaySession.updateMany({
        where: {
          id: input.sessionId,
          status: 'SUBMITTED',
          evaluatorId: null,
        },
        data: {
          evaluatorId: auth.user.userId,
          status: 'UNDER_REVIEW',
          reviewStartedAt: new Date(),
        },
      });

      if (claimed.count !== 1) {
        throw new Error('Concurrent evaluation detected or session not available');
      }

      const qaScore = await tx.qAScore.create({
        data: {
          interpreterId: session.interpreterId ?? null,
          auditDate: new Date(),
          auditor: auditorEmail,
          protocolScore: input.protocolScore,
          interpretationScore: input.interpretationScore,
          languageScore: input.languageScore,
          serviceScore: input.serviceScore,
          technicalScore: input.technicalScore,
          // Persist the canonical total so admin lists/dashboards never show null.
          totalScore,
          criticalError: input.criticalError,
          comentarios: input.comments,
          accionRequerida: actionRequired,
        },
        select: { id: true, totalScore: true },
      });

      await tx.roleplaySession.update({
        where: { id: input.sessionId },
        data: { 
          qaScoreId: qaScore.id,
          evaluatedAt: new Date(),
          status: 'EVALUATED',
        },
      });

      if (session.recruitmentCandidateId) {
        await tx.recruitmentCandidate.update({
          where: { id: session.recruitmentCandidateId },
          data: { resultRoleplay: Math.round(totalScore) },
        });
      }

      return {
        qaScoreId: qaScore.id,
        totalScore,
        actionRequired,
        interpreterId: session.interpreterId,
        recruitmentCandidateId: session.recruitmentCandidateId,
      };
    });

    // Pipeline bookkeeping: a passing evaluation advances the application to
    // interview. A failed evaluation intentionally leaves the application at
    // ROLEPLAY_REVIEW so rejection stays an explicit admin decision.
    // Guarded + best-effort (see advanceApplicationPipeline).
    if (result.recruitmentCandidateId && score.passed) {
      await advanceApplicationPipeline({
        candidateId: result.recruitmentCandidateId,
        fromStatuses: [
          'ROLEPLAY_PENDING',
          'ROLEPLAY_IN_PROGRESS',
          'ROLEPLAY_REVIEW',
        ],
        toStatus: 'INTERVIEW_PENDING',
        toStep: 'INTERVIEW',
        eventType: 'ROLEPLAY_PASSED',
        actorType: 'admin',
        actorId: auth.user.userId,
      });
    }

    // Send notification to interpreter if this was an interpreter session
    if (result.interpreterId) {
      try {
        const interpreter = await db.interpreter.findUnique({
          where: { id: result.interpreterId },
          select: { emailCorporativo: true, name: true },
        });

        if (interpreter?.emailCorporativo) {
          const profile = await db.userProfile.findUnique({
            where: { email: interpreter.emailCorporativo },
            select: { id: true },
          });

          if (profile) {
            const scoreDisplay = result.totalScore.toFixed(1);
            await createNotification({
              userId: profile.id,
              title: 'Roleplay Evaluado',
              message: `Tu roleplay "${interpreter.name}" fue evaluado: ${scoreDisplay}%. Acción: ${result.actionRequired}`,
              type: result.totalScore >= 85 ? 'success' : (result.totalScore >= 70 ? 'info' : 'warning'),
              link: `/dashboard/roleplays`,
            });
          }
        }
      } catch (notifyErr: unknown) {
        const message = notifyErr instanceof Error ? notifyErr.message : 'Unknown error';
        console.error('Notification failed but roleplay evaluation saved:', message);
      }
    }

    revalidatePath('/admin/roleplays');
    revalidatePath('/recruitment');
    revalidatePath('/qa');
    revalidatePath('/dashboard/roleplays');
    return { success: true, data: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Evaluate Roleplay Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}