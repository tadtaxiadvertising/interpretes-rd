// NOTE: intentionally NOT a 'use server' module. This service is a dormant
// server-side library (only imported by its own tests); marking it as server
// actions would expose every export as an RPC endpoint the moment any client
// module imports it. Server actions live in src/app/actions/*.
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { RecruitmentApplicationStatus, RecruitmentStep, RecruitmentEventType } from '@/lib/prisma-types';
import { candidateRepository } from '@/repositories/recruitment/candidate-repository';
import { applicationRepository } from '@/repositories/recruitment/application-repository';
import { accessRepository } from '@/repositories/recruitment/access-repository';

const db = prisma;

/**
 * Maps an application status to the valid RecruitmentEventType recorded when a
 * step advances INTO that status. The previous `${status}` cast produced values
 * (e.g. PROFILE_PENDING) that are not members of the event enum and would fail
 * at the database layer.
 */
const STATUS_EVENT_TYPE: Record<RecruitmentApplicationStatus, RecruitmentEventType> = {
  APPLIED: 'APPLICATION_CREATED',
  PROFILE_PENDING: 'PROFILE_COMPLETED',
  DOCUMENTS_PENDING: 'DOCUMENT_UPLOADED',
  LANGUAGE_PENDING: 'LANGUAGE_APPROVED',
  TECHNICAL_PENDING: 'TECHNICAL_COMPLETED',
  INDUCTION_PENDING: 'INDUCTION_COMPLETED',
  ROLEPLAY_PENDING: 'ROLEPLAY_CREATED',
  ROLEPLAY_IN_PROGRESS: 'ROLEPLAY_STARTED',
  ROLEPLAY_REVIEW: 'ROLEPLAY_SUBMITTED',
  INTERVIEW_PENDING: 'INTERVIEW_SCHEDULED',
  INTERVIEW_SCHEDULED: 'INTERVIEW_SCHEDULED',
  INTERVIEW_REVIEW: 'INTERVIEW_COMPLETED',
  OFFER_PENDING: 'OFFER_SENT',
  OFFER_SENT: 'OFFER_SENT',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  CONTRACT_PENDING: 'CONTRACT_SIGNED',
  BANKING_PENDING: 'BANKING_COMPLETED',
  TECH_SETUP_PENDING: 'TECH_SETUP_COMPLETED',
  TRAINING_PENDING: 'TRAINING_COMPLETED',
  READY_FOR_ACTIVATION: 'READY_FOR_ACTIVATION',
  HIRING: 'HIRING_STARTED',
  HIRED: 'HIRED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  EXPIRED: 'WITHDRAWN',
};

/**
 * RECRUITMENT SERVICE - Core business logic for recruitment workflow
 * 
 * All operations go through this service to ensure:
 * - Idempotency
 * - Proper state transitions
 * - Event logging
 * - Proper ownership/authentication
 * - Concurrency safety
 */

export interface CreateApplicationResult {
  success: boolean;
  applicationId?: string;
  candidateId?: number;
  error?: string;
  code?: string;
}

export interface AdvanceStepResult {
  success: boolean;
  application?: any;
  event?: any;
  error?: string;
  code?: string;
}

export interface RoleplayForApplication {
  sessionId?: string;
  status?: string;
  uploadUrl?: string;
  access?: any;
}

export interface HiringResult {
  success: boolean;
  interpreterId?: number;
  interpreter?: any;
  userProfileId?: string;
  error?: string;
  code?: string;
}

/**
 * Crea una nueva aplicación para un candidato
 */
export async function createApplication(email: string): Promise<CreateApplicationResult> {
  try {
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Try to find existing candidate
    const candidate = await candidateRepository.findByEmail(normalizedEmail);

    if (candidate) {
      // Candidate exists - check if there's an active application
      const existingApp = await applicationRepository.findByCandidateId(candidate.id);

      if (existingApp) {
        return {
          success: false,
          error: 'Ya existe una aplicación activa para este candidato',
          code: 'CONFLICT',
        };
      }

      // Create new application
      const application = await applicationRepository.getOrCreate(candidate.id);

      return {
        success: true,
        applicationId: application.id,
        candidateId: candidate.id,
      };
    }

    // Create new candidate
    const newCandidate = await candidateRepository.create({
      name: email.split('@')[0] || 'Candidate',
      email: normalizedEmail,
    });

    // Create application
    const application = await applicationRepository.getOrCreate(newCandidate.id);

    return {
      success: true,
      applicationId: application.id,
      candidateId: newCandidate.id,
    };
  } catch (error) {
    console.error('[Recruitment Service Error createApplication]:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error interno al crear la aplicación',
      code: 'INTERNAL_ERROR',
    };
  }
}

/**
 * Avanza el estado de una aplicación
 */
export async function advanceStep(
  applicationId: string,
  newStatus: RecruitmentApplicationStatus,
  newStep: RecruitmentStep,
  actorType: 'candidate' | 'admin' | 'system',
  actorId: string,
  metadata?: any
): Promise<AdvanceStepResult> {
  try {
    const current = await applicationRepository.findById(applicationId);
    if (!current) {
      return { success: false, error: 'Aplicación no encontrada', code: 'NOT_FOUND' };
    }

    // The repository performs the optimistic status check and logs the event
    // inside its transaction; the service must not log a second event.
    const result = await applicationRepository.advanceStep(
      applicationId,
      current.status,
      newStatus,
      newStep,
      actorId,
      actorType,
      STATUS_EVENT_TYPE[newStatus] ?? 'APPLICATION_CREATED',
      metadata
    );

    return {
      success: true,
      application: result,
    };
  } catch (error) {
    console.error('[Recruitment Service Error advanceStep]:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al avanzar el paso',
      code: 'INTERNAL_ERROR',
    };
  }
}

/**
 * Obtiene el estado actual de la aplicación
 */
export async function getApplication(applicationId: string) {
  const app = await applicationRepository.findById(applicationId);
  if (!app) {
    return { success: false, error: 'Aplicación no encontrada', code: 'NOT_FOUND' };
  }
  return { success: true, application: app };
}

/**
 * Obtiene la aplicación activa por candidato
 */
export async function getActiveApplication(candidateId: number) {
  const app = await applicationRepository.findByCandidateId(candidateId);
  return { success: !!app, application: app };
}

/**
 * Crea o reanuda una sesión de roleplay para la aplicación
 */
export async function createOrResumeRoleplay(
  applicationId: string,
  targetType: 'candidate' | 'interpreter',
  targetId: number
): Promise<{ success: boolean; result?: RoleplayForApplication; error?: string }> {
  try {
    const { randomBytes, createHash } = await import('crypto');
    const parsedTargetType = targetType === 'candidate';

    // Using roleplay service logic inline
    const result = await db.$transaction(async (tx) => {
      // Check for existing active session
      const existing = await tx.roleplaySession.findFirst({
        where: {
          OR: [
            { recruitmentCandidateId: parsedTargetType ? targetId : undefined },
            { interpreterId: parsedTargetType ? undefined : targetId },
          ],
          status: { in: ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS'] },
        },
      });

      if (existing) {
        // Generate access if needed - use roleplay access directly
        let access;
        if (!(existing as any).access) {
          // Create roleplay access for the session
          const { randomBytes, createHash } = await import('crypto');
          const rawToken = randomBytes(32).toString('hex');
          const tokenHash = createHash('sha256').update(rawToken).digest('hex');
          const inviteCode = randomBytes(4).toString('base64url').slice(0, 8).toUpperCase();
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

          access = await tx.roleplayAccess.create({
            data: {
              sessionId: existing.id,
              tokenHash,
              inviteCode,
              expiresAt,
            },
          });
        }

        return {
          sessionId: existing.id,
          status: 'INVITED',
          uploadUrl: existing.baseAudioUrl,
          access,
        };
      }

      // Create new session
      const newSession = await tx.roleplaySession.create({
        data: {
          interpreterId: parsedTargetType ? null : undefined,
          recruitmentCandidateId: parsedTargetType ? targetId : undefined,
          baseAudioUrl: 'https://storage.freeinterpreters.com/base-audio-placeholder.webm',
          status: 'DRAFT',
          currentScenarioIndex: 0,
        },
        select: { id: true },
      });

      // Create access for candidate sessions
      let access;
      if (parsedTargetType) {
        access = await accessRepository.getOrCreate(newSession.id);
      }

      // Update status to INVITED
      await tx.roleplaySession.update({
        where: { id: newSession.id },
        data: { status: 'INVITED' },
      });

      return {
        sessionId: newSession.id,
        status: 'INVITED',
        uploadUrl: 'https://storage.freeinterpreters.com/base-audio-placeholder.webm',
        access,
      };
    });

    return { success: true, result };
  } catch (error) {
    console.error('[Recruitment Service Error createOrResumeRoleplay]:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error al crear roleplay' };
  }
}

/**
 * Procesa la respuesta de roleplay (guardado automático)
 */
export async function saveRoleplayResponse(
  sessionId: string,
  scenarioId: string,
  data: { recordedAudioUrl?: string; durationSec?: number; selfScore?: any; selfNotes?: string }
) {
  try {
    const response = await db.roleplayResponse.upsert({
      where: { id: scenarioId },
      create: {
        scenarioId,
        sourceAudioUrl: data.recordedAudioUrl,
        sourceAudioPath: data.recordedAudioUrl,
        audioStatus: 'UPLOADED',
        durationSec: data.durationSec,
        selfScore: data.selfScore,
        selfNotes: data.selfNotes,
        submittedAt: new Date(),
      },
      update: {
        sourceAudioUrl: data.recordedAudioUrl,
        sourceAudioPath: data.recordedAudioUrl,
        audioStatus: 'UPLOADED',
        durationSec: data.durationSec,
        selfScore: data.selfScore,
        selfNotes: data.selfNotes,
        submittedAt: new Date(),
      },
    });

    return { success: true, data: response };
  } catch (error) {
    console.error('[Recruitment Service Error saveRoleplayResponse]:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error al guardar respuesta' };
  }
}

/**
 * Evalúa el roleplay (solo administradores)
 */
export async function evaluateRoleplay(
  sessionId: string,
  auditorId: string,
  scores: { protocolScore: number; interpretationScore: number; languageScore: number; serviceScore: number; technicalScore: number; criticalError: boolean; comments?: string }
) {
  try {
    // Calculate weighted score
    let totalScore = 0;
    if (scores.criticalError) {
      totalScore = 0;
    } else {
      totalScore = 
        (scores.protocolScore * 0.35) +
        (scores.interpretationScore * 0.40) +
        (scores.languageScore * 0.15) +
        (scores.serviceScore * 0.05) +
        (scores.technicalScore * 0.05);
    }

    const actionRequired = scores.criticalError || totalScore < 70 
      ? 'Advertencia / Coaching' 
      : totalScore < 85 
        ? 'Feedback Requerido' 
        : 'Ninguno';

    const result = await db.$transaction(async (tx) => {
      // Claim for evaluation (atomic)
      const claimed = await tx.roleplaySession.update({
        where: { 
          id: sessionId,
          status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
          evaluatorId: null,
        },
        data: { 
          evaluatorId: auditorId,
          status: 'UNDER_REVIEW',
          reviewStartedAt: new Date(),
        },
      });

      if (!claimed) {
        throw new Error('Sesión ya reclamada por otro evaluador');
      }

      // Create QA score
      const qaScore = await tx.qAScore.create({
        data: {
          interpreterId: null, // Will be filled based on candidate/interpreter
          auditor: auditorId,
          auditDate: new Date(), // Required field
          protocolScore: scores.protocolScore,
          interpretationScore: scores.interpretationScore,
          languageScore: scores.languageScore,
          serviceScore: scores.serviceScore,
          technicalScore: scores.technicalScore,
          criticalError: scores.criticalError,
          accionRequerida: actionRequired,
        },
      });

      // Update session
      await tx.roleplaySession.update({
        where: { id: sessionId },
        data: { 
          qaScoreId: qaScore.id,
          evaluatedAt: new Date(),
          status: 'EVALUATED',
        },
      });

      return { qaScoreId: qaScore.id, totalScore: Math.round(totalScore * 100) / 100, actionRequired };
    });

    return { success: true, data: result };
  } catch (error) {
    console.error('[Recruitment Service Error evaluateRoleplay]:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error al evaluar roleplay' };
  }
}

/**
 * Contrata a un candidato (transacción atómica)
 */
export async function hireCandidate(
  applicationId: string,
  actorId: string,
  actorType: 'admin' | 'system'
): Promise<HiringResult> {
  try {
    const application = await applicationRepository.findById(applicationId);
    if (!application) {
      return { success: false, error: 'Aplicación no encontrada', code: 'NOT_FOUND' };
    }

    // The application include does not carry the candidate; load it explicitly.
    const candidate = await candidateRepository.findById(application.candidateId);
    if (!candidate) {
      return { success: false, error: 'Candidato no encontrado', code: 'NOT_FOUND' };
    }

    // Verificar que la aplicación esté lista para contratación
    if (!['READY_FOR_ACTIVATION', 'HIRING'].includes(application.status)) {
      return { success: false, error: `La aplicación no está lista para contratación. Estado actual: ${application.status}`, code: 'INVALID_STATE' };
    }

    // Transaction: Create interpreter, user profile, link everything
    const result = await db.$transaction(async (tx) => {
      // 1. Verificar si ya existe un intérprete con esta identidad
      const existingInterpreter = await tx.interpreter.findFirst({
        where: { emailCorporativo: candidate.email },
        select: { id: true },
      });

      let interpreterId: number;
      let userProfileId: string;

      if (existingInterpreter) {
        interpreterId = existingInterpreter.id;
      } else {
        // Create new interpreter
        const newInterpreter = await tx.interpreter.create({
          data: {
            externalId: `recruitment-candidate-${candidate.id}`,
            name: candidate.name,
            emailCorporativo: candidate.email,
            status: 'Activo',
            realtimeStatus: 'Offline',
            tariffPerMinute: 0,
            monthlyGoal: 2000,
            languageA: 'Español',
            languageB: 'Inglés',
          },
          select: { id: true },
        });
        interpreterId = newInterpreter.id;
      }

      // 2. Upsert the profile keyed on the unique email. user_profiles.id is a
      //    uuid column, so it must NOT reuse the cuid application id.
      const profile = await tx.userProfile.upsert({
        where: { email: candidate.email },
        update: { interpreterId },
        create: {
          id: randomUUID(),
          email: candidate.email,
          displayName: candidate.name,
          role: 'interpreter',
          interpreterId,
        },
        select: { id: true },
      });
      userProfileId = profile.id;

      // Update application status
      await tx.recruitmentApplication.update({
        where: { id: applicationId },
        data: {
          status: 'HIRED',
          hiredInterpreterId: interpreterId,
          currentStep: 'HIRING',
          completedAt: new Date(),
        },
      });

      // Log hiring event
      await tx.recruitmentEvent.create({
        data: {
          applicationId,
          eventType: 'HIRED',
          fromStatus: application.status as any,
          toStatus: 'HIRED',
          actorType: actorType,
          actorId,
        },
      });

      return { interpreterId, userProfileId };
    });

    return { success: true, interpreterId: result.interpreterId, userProfileId: result.userProfileId };
  } catch (error) {
    console.error('[Recruitment Service Error hireCandidate]:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error al contratar candidato' };
  }
}

export const recruitmentService = {
  createApplication,
  advanceStep,
  getApplication,
  getActiveApplication,
  createOrResumeRoleplay,
  saveRoleplayResponse,
  evaluateRoleplay,
  hireCandidate,
};