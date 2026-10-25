'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import { revalidatePath } from 'next/cache';
import { createSignedUploadUrl, getBaseAudioPath, getResponseAudioPath, confirmUpload, validateAudioFile } from '@/lib/roleplay';
import { createNotification } from './notifications';
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import { cookies } from 'next/headers';
import type { RecruitmentApplicationStatus, RecruitmentStep, RecruitmentEventType } from '@/lib/prisma-types';
import { calculateRoleplayScore } from '@/lib/roleplay/scoring';
import { advanceApplication } from '@/services/recruitment/transitions';

const db = prisma;

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

  const validation = validateAudioFile(new File([], 'test', { type: input.baseAudioMimeType, }));
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
    const signedUrl = await confirmUpload(uploadPath);
    
    await db.roleplaySession.update({
      where: { id: sessionId },
      data: { baseAudioUrl: signedUrl },
    });

    revalidatePath('/admin/roleplays');
    return { success: true, data: { baseAudioUrl: signedUrl } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Confirm Base Audio Error:', message);
    return { success: false, error: message };
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
 * account email), reuses any active session instead of creating duplicates,
 * guarantees at least one scenario exists, and issues the opaque
 * `roleplay_session` cookie that the candidate-facing submit paths require.
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
  if (!identity || identity.role !== 'interpreter' || identity.email?.toLowerCase().trim() !== email) {
    return { success: false as const, error: 'Access denied', code: 'UNAUTHORIZED' as const };
  }
  if (identity.eligibility.needsOnboarding) {
    return {
      success: false as const,
      error: 'Completa el onboarding antes de iniciar el roleplay.',
      code: 'CONFLICT' as const,
    };
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
      'APPLIED',
      'INDUCTION_PENDING',
      'ROLEPLAY_PENDING',
      'ROLEPLAY_IN_PROGRESS',
      'ROLEPLAY_REVIEW',
    ];
    if (application && !startableApplicationStatuses.includes(application.status)) {
      return {
        success: false as const,
        error: 'Tu postulación no está habilitada para iniciar un roleplay en esta etapa.',
        code: 'CONFLICT' as const,
      };
    }

    // Review explicitly permits a retry, but the state machine requires the
    // application to return to ROLEPLAY_PENDING before it can become IN_PROGRESS.
    const retryingFromReview = application?.status === 'ROLEPLAY_REVIEW';
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

    // A reviewed attempt is historical evidence. Retrying must create a new
    // session and copy only its scenario definition, never its responses or QA.
    // Ordinary page refreshes still resume the current in-flight session.
    const shouldCreateRetry = retryingFromReview && previousSession &&
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
    } else if (!previousSession) {
      session = await db.roleplaySession.create({
        data: {
          recruitmentCandidateId: candidate.id,
          baseAudioUrl: '',
          status: 'STARTED',
        },
        select: { id: true, status: true },
      });
    } else {
      session = { id: previousSession.id, status: previousSession.status };
      if (['DRAFT', 'INVITED', 'PENDING'].includes(session.status)) {
        // Only pre-submit states advance to STARTED. Submitted/reviewed attempts
        // are never reset as part of a normal resume.
        await db.roleplaySession.update({
          where: { id: session.id },
          data: { status: 'STARTED' },
        });
      }
    }

    const scenarioCount = await db.roleplayScenario.count({ where: { sessionId: session.id } });
    if (scenarioCount === 0) {
      await db.roleplayScenario.create({
        data: {
          sessionId: session.id,
          order: 0,
          title: 'Escenario 1',
          baseAudioUrl: '',
          durationLimitSec: null,
          scriptPrompt: null,
          expectedKeys: [],
        },
      });
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
  const auth = await validateAction('interpreter');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parseResult = SubmitResponseSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;

  try {
    const session = await db.roleplaySession.findUnique({
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
      return { success: false, error: 'Session not found', code: 'NOT_FOUND' };
    }

    const validSubmitStates = ['INVITED', 'STARTED', 'IN_PROGRESS', 'PENDING'];
    if (!validSubmitStates.includes(session.status)) {
      return { success: false, error: 'Session is not in a state that allows submitting responses', code: 'INVALID_STATE' };
    }

    if (session.recordedAudioUrl) {
      return { success: false, error: 'Response already submitted', code: 'ALREADY_SUBMITTED' };
    }

    const sessionCookie = (await cookies()).get('roleplay_session')?.value ?? null;

    if (session.interpreterId) {
      if (session.interpreterId !== auth.profile?.interpreterId) {
        return { success: false, error: 'Unauthorized', code: 'FORBIDDEN' };
      }
    } else if (session.recruitmentCandidateId) {
      if (sessionCookie !== session.id) {
        return { success: false, error: 'Unauthorized', code: 'FORBIDDEN' };
      }
    } else {
      return { success: false, error: 'Unauthorized', code: 'FORBIDDEN' };
    }

    // Client will upload directly to /api/roleplay/convert-audio
    // We just return success and the session info for the client to call the API
    const scenarioId = input.scenarioId || `scenario_${session.currentScenarioIndex}`;

    // Sequential binding: a supplied scenarioId must be the next expected one.
    // Without this, a client could skip steps in the same session.
    const expectedScenarioId = `scenario_${session.currentScenarioIndex}`;
    if (input.scenarioId && input.scenarioId !== expectedScenarioId) {
      return { success: false, error: 'Escenario no disponible', code: 'FORBIDDEN' };
    }

    return {
      success: true, 
      data: { 
        sessionId: session.id,
        scenarioId,
        convertApiUrl: '/api/roleplay/convert-audio',
      } 
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Submit Response Error:', message);
    return { success: false, error: message, code: 'INTERNAL_ERROR' };
  }
}

const ConfirmResponseSchema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1).optional(),
  recordedAudioUrl: z.string().min(1),
  sourceAudioPath: z.string().min(1).max(1024).optional(),
  durationSec: z.number().int().min(0).max(86400).optional(),
  selfScore: z.record(z.string(), z.number()).optional(),
  selfNotes: z.string().optional(),
});

export type ConfirmResponseInput = z.infer<typeof ConfirmResponseSchema>;

export async function confirmRoleplayResponse(rawInput: ConfirmResponseInput) {
  const auth = await validateAction('interpreter');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parseResult = ConfirmResponseSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
  const input = parseResult.data;

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
      if (session.interpreterId) {
        if (session.interpreterId !== auth.profile?.interpreterId) {
          throw new Error('Unauthorized');
        }
      } else if (session.recruitmentCandidateId) {
        if (sessionCookie !== session.id) {
          throw new Error('Unauthorized');
        }
      } else {
        throw new Error('Unauthorized');
      }

      // A supplied scenario must belong to this session. Without this check a
      // caller could read or overwrite another session's response by passing
      // a foreign scenario id (cross-session write).
      if (input.scenarioId) {
        const scenario = await tx.roleplayScenario.findFirst({
          where: { id: input.scenarioId, sessionId: session.id },
          select: { id: true },
        });
        if (!scenario) {
          throw new Error('Unauthorized');
        }

        // Sequential binding: a targeted scenario must be the one expected at
        // the session's current index, so a candidate cannot skip steps.
        const nextScenario = await tx.roleplayScenario.findFirst({
          where: { sessionId: session.id, order: session.currentScenarioIndex },
          select: { id: true },
        });
        if (!nextScenario || nextScenario.id !== input.scenarioId) {
          throw new Error('Unauthorized');
        }
      }

      const validSubmitStates = ['INVITED', 'STARTED', 'IN_PROGRESS', 'PENDING'];
      const canSubmit = validSubmitStates.includes(session.status);

      if (!canSubmit) {
        // Idempotent replay: a retried confirm whose response is already
        // recorded succeeds without writing; any other write is rejected.
        if (input.scenarioId) {
          const recorded = await tx.roleplayResponse.findFirst({
            where: { scenarioId: input.scenarioId, sourceAudioUrl: input.recordedAudioUrl },
            select: { id: true },
          });
          if (recorded) {
            return { recordedAudioUrl: input.recordedAudioUrl, submitted: true, candidateId: session.recruitmentCandidateId };
          }
        }
        throw new Error('Session not available for submission');
      }

      // Legacy callers that do not target a scenario row keep the original
      // single-submission semantics: one recorded response per session.
      if (!input.scenarioId && session.recordedAudioUrl) {
        throw new Error('Session not available for submission');
      }

      // Persist the per-scenario response against the real RoleplayScenario row
      // when the client supplies a scenario id (cuid). The legacy
      // `scenario_<index>` fallback has no row to attach to, so it is skipped.
      if (input.scenarioId) {
        const existingResponse = await tx.roleplayResponse.findFirst({
          where: { scenarioId: input.scenarioId },
          select: { id: true },
        });
        if (existingResponse) {
          await tx.roleplayResponse.update({
            where: { id: existingResponse.id },
            data: {
              sourceAudioUrl: input.recordedAudioUrl,
              sourceAudioPath: input.sourceAudioPath ?? undefined,
              durationSec: input.durationSec ?? undefined,
              selfScore: input.selfScore ?? undefined,
              selfNotes: input.selfNotes ?? null,
              submittedAt: new Date(),
            },
          });
        } else {
          await tx.roleplayResponse.create({
            data: {
              scenarioId: input.scenarioId,
              sourceAudioUrl: input.recordedAudioUrl,
              sourceAudioPath: input.sourceAudioPath ?? null,
              durationSec: input.durationSec ?? null,
              selfScore: input.selfScore ?? undefined,
              selfNotes: input.selfNotes ?? null,
              submittedAt: new Date(),
            },
          });
        }
      }

      // Progress is derived from persisted responses so a retried confirm
      // cannot advance the session twice.
      const totalScenarios = await tx.roleplayScenario.count({ where: { sessionId: session.id } });
      const respondedCount = await tx.roleplayResponse.count({
        where: { scenario: { sessionId: session.id } },
      });
      const isFinal = input.scenarioId
        ? totalScenarios > 0 && respondedCount >= totalScenarios
        : totalScenarios > 0 && session.currentScenarioIndex + 1 >= totalScenarios;

      const updated = await tx.roleplaySession.update({
        where: { id: input.sessionId },
        data: {
          recordedAudioUrl: input.recordedAudioUrl,
          submittedAt: new Date(),
          ...(input.scenarioId
            ? { currentScenarioIndex: respondedCount }
            : { currentScenarioIndex: { increment: 1 } }),
          ...(isFinal ? { status: 'SUBMITTED' as const } : {}),
        },
        select: { id: true },
      });

      if (!updated) {
        throw new Error('Concurrent submission detected');
      }

      // Invitation lifecycle: validate -> start -> consume. Validation and
      // start never consume; the invitation is spent exactly once here, when a
      // candidate submits the final scenario and the session moves to
      // SUBMITTED. The `usedAt: null` predicate makes the claim atomic and
      // idempotent so a concurrent or retried submit cannot double-consume.
      // Interpreter sessions have no candidate invitation and are not consumed.
      if (isFinal && session.recruitmentCandidateId) {
        await tx.roleplayAccess.updateMany({
          where: { sessionId: session.id, usedAt: null },
          data: { usedAt: new Date() },
        });
      }

      return { recordedAudioUrl: input.recordedAudioUrl, submitted: isFinal, candidateId: session.recruitmentCandidateId };
    });

    // Pipeline bookkeeping: the final submit moves the application to review.
    // Guarded + best-effort; runs after the submit transaction so a pipeline
    // failure can never roll back a recorded submission.
    if (result.submitted && result.candidateId) {
      await advanceApplicationPipeline({
        candidateId: result.candidateId,
        fromStatuses: ['APPLIED', 'INDUCTION_PENDING', 'ROLEPLAY_PENDING', 'ROLEPLAY_IN_PROGRESS'],
        toStatus: 'ROLEPLAY_REVIEW',
        toStep: 'ROLEPLAY_REVIEW',
        eventType: 'ROLEPLAY_SUBMITTED',
        actorType: 'candidate',
        actorId: String(result.candidateId),
      });
    }

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
  scores: z.record(z.string(), z.number().min(0).max(10)),
  criticalError: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

export type SelfAssessmentInput = z.infer<typeof SelfAssessmentSchema>;

export async function saveSelfAssessment(rawInput: SelfAssessmentInput) {
  const auth = await validateAction('interpreter');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  const parseResult = SelfAssessmentSchema.safeParse(rawInput);
  if (!parseResult.success) return { success: false, error: 'Invalid input', code: 'VALIDATION_ERROR' };
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
        },
      });

      if (!session) throw new Error('Session not available for submission');

      if (session.interpreterId) {
        if (session.interpreterId !== auth.profile?.interpreterId) throw new Error('Unauthorized');
      } else if (session.recruitmentCandidateId) {
        if (sessionCookie !== session.id) throw new Error('Unauthorized');
      } else {
        throw new Error('Unauthorized');
      }

      const scenario = await tx.roleplayScenario.findFirst({
        where: { id: input.scenarioId, sessionId: session.id },
        select: { id: true },
      });
      if (!scenario) throw new Error('Unauthorized');

      // Self-assessment attaches to the already-confirmed response row; the
      // audio confirm must happen first so QA always has an audio to grade.
      const response = await tx.roleplayResponse.findFirst({
        where: { scenarioId: input.scenarioId },
        select: { id: true },
      });
      if (!response) throw new Error('No confirmed response to assess');

      await tx.roleplayResponse.update({
        where: { id: response.id },
        data: {
          // Canonical shape: the five QA dimensions plus the critical-error
          // flag, so the admin evaluation view reads exactly what the
          // candidate submitted (see admin/roleplays/[id]/page.tsx).
          selfScore: { ...input.scores, criticalError: input.criticalError ?? false },
          selfNotes: input.notes ?? null,
        },
      });
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

    const validInviteStates = ['DRAFT', 'INVITED', 'PENDING'];
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

  // Parse form data (dimension scores are 0..10)
  const rawInput = {
    sessionId: formData.get('sessionId') as string,
    protocolScore: parseFloat(formData.get('protocolScore') as string) || 0,
    interpretationScore: parseFloat(formData.get('interpretationScore') as string) || 0,
    languageScore: parseFloat(formData.get('languageScore') as string) || 0,
    serviceScore: parseFloat(formData.get('serviceScore') as string) || 0,
    technicalScore: parseFloat(formData.get('technicalScore') as string) || 0,
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