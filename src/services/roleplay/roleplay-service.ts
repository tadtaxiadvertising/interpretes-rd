'use server';

import { roleplayRepository } from '@/repositories/roleplay/roleplay-repository';
import { roleplayAccessRepository, AccessWithToken } from '@/repositories/roleplay/roleplay-access-repository';
import { resolveCurrentIdentity, RoleplayState } from '@/lib/identity/resolve-user';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { createSignedUploadUrl, getBaseAudioPath, getResponseAudioPath, confirmUpload, validateAudioFile } from '@/lib/roleplay';
import { randomBytes, createHash } from 'crypto';

const db = prisma;

const CreateAssessmentSchema = z.object({
  targetType: z.enum(['interpreter', 'candidate']),
  targetId: z.number().int().positive(),
  baseAudioMimeType: z.string(),
  baseAudioSize: z.number().int().positive().max(50 * 1024 * 1024), // 50 MB
  scenarios: z.array(z.object({
    order: z.number().int().min(0),
    title: z.string().min(1),
    baseAudioUrl: z.string().url(),
    durationLimitSec: z.number().int().positive().optional(),
    scriptPrompt: z.string().optional(),
    expectedKeys: z.array(z.string()).optional(),
  })).min(1).optional(),
});

export type CreateAssessmentInput = z.infer<typeof CreateAssessmentSchema>;

export interface AssessmentResult {
  sessionId: string;
  status: RoleplayState;
  uploadUrl?: string;
  uploadPath?: string;
  inviteToken?: string;
  access?: AccessWithToken;
}

const VALID_STATUSES: RoleplayState[] = [
  'DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 
  'SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 
  'PASSED', 'FAILED', 'EXPIRED', 'CANCELLED'
];

const VALID_TRANSITIONS: Record<RoleplayState, RoleplayState[]> = {
  'NO_ROLEPLAY': ['DRAFT'],
  'DRAFT': ['INVITED', 'CANCELLED'],
  'INVITED': ['STARTED', 'EXPIRED', 'CANCELLED'],
  'STARTED': ['IN_PROGRESS', 'CANCELLED'],
  'IN_PROGRESS': ['SUBMITTED', 'CANCELLED'],
  'SUBMITTED': ['UNDER_REVIEW', 'CANCELLED'],
  'UNDER_REVIEW': ['EVALUATED', 'CANCELLED'],
  'EVALUATED': ['PASSED', 'FAILED'],
  'PASSED': [],
  'FAILED': [],
  'EXPIRED': [],
  'CANCELLED': [],
};

/**
 * Roleplay Service - Centralized business logic for roleplay assessments
 */
export class RoleplayService {
  /**
   * Create or resume an assessment for a target (idempotent)
   * If an active session exists, returns it; otherwise creates new
   */
  async createOrResumeAssessment(input: CreateAssessmentInput): Promise<AssessmentResult> {
    // Validate input
    const parseResult = CreateAssessmentSchema.safeParse(input);
    if (!parseResult.success) {
      return { 
        sessionId: '', 
        status: 'CANCELLED', 
        error: 'Invalid input', 
        code: 'VALIDATION_ERROR' 
      } as any;
    }

    const validated = parseResult.data;
    const target = validated.targetType === 'interpreter' 
      ? { interpreterId: validated.targetId }
      : { recruitmentCandidateId: validated.targetId };

    // Check for existing active session (idempotency)
    const existing = await roleplayRepository.findActiveSession(target);
    if (existing) {
      // Generate access if needed
      let access: AccessWithToken | undefined;
      if (!existing.access) {
        access = await roleplayAccessRepository.getOrCreateAccess(existing.id);
      }

      return {
        sessionId: existing.id,
        status: this.mapDbStatusToState(existing.status, existing.access),
        uploadUrl: existing.baseAudioUrl,
        access,
      };
    }

    // Validate audio file type
    const validation = validateAudioFile(new File([], 'test', { type: validated.baseAudioMimeType }));
    if (!validation.valid || !validation.extension) {
      return { 
        success: false,
        sessionId: '', 
        status: 'CANCELLED', 
        error: validation.error, 
        code: 'VALIDATION_ERROR' 
      } as any;
    }

    // Create session
    const session = await db.$transaction(async (tx) => {
      // Create session
      const newSession = await tx.roleplaySession.create({
        data: {
          interpreterId: target.interpreterId ?? null,
          recruitmentCandidateId: target.recruitmentCandidateId ?? null,
          baseAudioUrl: getBaseAudioPath('', validation.extension!),
          status: 'DRAFT',
          currentScenarioIndex: 0,
        },
        select: { id: true },
      });

      // Update with correct base audio path
      const baseAudioPath = getBaseAudioPath(newSession.id, validation.extension!);
      await tx.roleplaySession.update({
        where: { id: newSession.id },
        data: { baseAudioUrl: baseAudioPath },
      });

      // Create scenarios if provided
      if (validated.scenarios && validated.scenarios.length > 0) {
        await tx.roleplayScenario.createMany({
          data: validated.scenarios.map((s, i) => ({
            sessionId: newSession.id,
            order: s.order ?? i,
            title: s.title,
            baseAudioUrl: s.baseAudioUrl,
            durationLimitSec: s.durationLimitSec,
            scriptPrompt: s.scriptPrompt,
            expectedKeys: s.expectedKeys ?? [],
          })),
        });
      }

      return newSession.id;
    });

    // Create access for candidate sessions
    let access: AccessWithToken | undefined;
    if (target.recruitmentCandidateId) {
      access = await roleplayAccessRepository.getOrCreateAccess(session);
    }

    // Update status to INVITED (from DRAFT)
    const updated = await roleplayRepository.transitionStatus(
      session,
      'DRAFT',
      'INVITED'
    );

    revalidatePath('/admin/roleplays');
    return {
      sessionId: session,
      status: 'INVITED',
      uploadUrl: updated?.baseAudioUrl,
      access,
    };
  }

  /**
   * Get assessment by ID with full details
   */
  async getAssessment(sessionId: string) {
    return roleplayRepository.findById(sessionId);
  }

  /**
   * Resume assessment - verify user has access and return session
   */
  async resumeAssessment(sessionId: string): Promise<AssessmentResult | { error: string; code: string }> {
    const identity = await resolveCurrentIdentity();
    if (!identity) {
      return { error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    const session = await roleplayRepository.findById(sessionId);
    if (!session) {
      return { error: 'Session not found', code: 'NOT_FOUND' };
    }

    // Verify ownership
    if (identity.role !== 'admin') {
      if (session.interpreterId && session.interpreterId !== identity.interpreterId) {
        return { error: 'Access denied', code: 'FORBIDDEN' };
      }
      if (session.recruitmentCandidateId) {
        // For candidates, verify via access token (handled by invite flow)
        const access = session.access;
        if (!access || !access.usedAt) {
          return { error: 'Invalid or expired invitation', code: 'INVALID_TOKEN' };
        }
      }
    }

    const status = this.mapDbStatusToState(session.status, session.access);
    
    return {
      sessionId: session.id,
      status,
      access: session.access ? { ...session.access, rawToken: undefined } : undefined,
    };
  }

  /**
   * Start assessment - mark token as started, update session status
   */
  async startAssessment(token: string): Promise<AssessmentResult | { error: string; code: string }> {
    // Mark token as started (not consumed yet)
    const access = await roleplayAccessRepository.markStarted(token);
    if (!access) {
      return { error: 'Invalid or expired invitation', code: 'INVALID_TOKEN' };
    }

    // Update session status to STARTED
    const updated = await roleplayRepository.transitionStatus(
      access.sessionId,
      ['INVITED', 'DRAFT'],
      'STARTED'
    );

    if (!updated) {
      return { error: 'Session no longer available for start', code: 'INVALID_STATE' };
    }

    revalidatePath('/admin/roleplays');
    return {
      sessionId: updated.id,
      status: 'STARTED',
      access: { ...access, rawToken: undefined },
    };
  }

  /**
   * Save response for a scenario (autosave)
   */
  async saveResponse(sessionId: string, scenarioId: string, data: {
    recordedAudioUrl?: string;
    sourceAudioPath?: string;
    durationSec?: number;
    selfScore?: Record<string, number>;
    selfNotes?: string;
  }): Promise<{ success: true; data: any } | { success: false; error: string; code: string }> {
    const identity = await resolveCurrentIdentity();
    if (!identity) {
      return { success: false, error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    const session = await roleplayRepository.findById(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found', code: 'NOT_FOUND' };
    }

    // Verify ownership
    if (identity.role !== 'admin' && session.interpreterId !== identity.interpreterId) {
      // Check if candidate with valid access
      if (session.recruitmentCandidateId) {
        const access = session.access;
        if (!access) {
          return { success: false, error: 'Invalid access', code: 'FORBIDDEN' };
        }
      } else {
        return { success: false, error: 'Access denied', code: 'FORBIDDEN' };
      }
    }

    // Verify session state allows saving responses
    const validStates: RoleplayState[] = ['STARTED', 'IN_PROGRESS'];
    const currentState = this.mapDbStatusToState(session.status, session.access);
    if (!validStates.includes(currentState)) {
      return { success: false, error: 'Session not in a state that allows saving responses', code: 'INVALID_STATE' };
    }

    try {
      // One response row per scenario: locate by scenarioId, then update or
      // create. An upsert keyed on the response id would duplicate rows.
      const existing = await db.roleplayResponse.findFirst({
        where: { scenarioId },
        select: { id: true },
      });

      const response = existing
        ? await db.roleplayResponse.update({
            where: { id: existing.id },
            data: {
              sourceAudioUrl: data.recordedAudioUrl,
              sourceAudioPath: data.sourceAudioPath ?? undefined,
              audioStatus: 'UPLOADED',
              durationSec: data.durationSec,
              selfScore: data.selfScore ?? undefined,
              selfNotes: data.selfNotes,
              submittedAt: new Date(),
            },
          })
        : await db.roleplayResponse.create({
            data: {
              scenarioId,
              sourceAudioUrl: data.recordedAudioUrl,
              sourceAudioPath: data.sourceAudioPath ?? null,
              audioStatus: 'UPLOADED',
              durationSec: data.durationSec,
              selfScore: data.selfScore ?? undefined,
              selfNotes: data.selfNotes,
              submittedAt: new Date(),
            },
          });

      return { success: true, data: response };
    } catch (error) {
      console.error('[ROLEPLAY] saveResponse error:', error);
      return { success: false, error: 'Failed to save response', code: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Submit assessment - finalize and move to SUBMITTED
   */
  async submitAssessment(sessionId: string): Promise<{ success: true; data: any } | { success: false; error: string; code: string }> {
    const identity = await resolveCurrentIdentity();
    if (!identity) {
      return { success: false, error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    const session = await roleplayRepository.findById(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found', code: 'NOT_FOUND' };
    }

    // Verify ownership
    if (identity.role !== 'admin' && session.interpreterId !== identity.interpreterId) {
      if (session.recruitmentCandidateId) {
        const access = session.access;
        if (!access || !access.usedAt) {
          return { success: false, error: 'Invalid access', code: 'FORBIDDEN' };
        }
      } else {
        return { success: false, error: 'Access denied', code: 'FORBIDDEN' };
      }
    }

    // Verify all scenarios have responses
    const scenariosWithResponses = session.scenarios.filter(s => s.responses && s.responses.length > 0);
    if (scenariosWithResponses.length !== session.scenarios.length) {
      return { 
        success: false, 
        error: `All ${session.scenarios.length} scenarios must have responses before submitting`, 
        code: 'INVALID_STATE' 
      };
    }

    // Verify session is in IN_PROGRESS state
    const currentState = this.mapDbStatusToState(session.status, session.access);
    if (currentState !== 'IN_PROGRESS') {
      return { 
        success: false, 
        error: 'Session must be IN_PROGRESS to submit', 
        code: 'INVALID_STATE' 
      };
    }

    // Atomic transition to SUBMITTED
    const updated = await roleplayRepository.transitionStatus(
      sessionId,
      'IN_PROGRESS',
      'SUBMITTED',
      { submittedAt: new Date() }
    );

    if (!updated) {
      return { success: false, error: 'Session state changed during submission', code: 'CONFLICT' };
    }

    // If candidate, consume the access token now
    if (session.recruitmentCandidateId && session.access && !session.access.usedAt) {
      const token = session.access.tokenHash; // We need the raw token - this is a limitation
      // In practice, we'd store the token differently or consume via session
      await db.roleplayAccess.update({
        where: { sessionId },
        data: { usedAt: new Date() },
      });
    }

    revalidatePath('/admin/roleplays');
    revalidatePath('/dashboard/roleplays');
    
    return { success: true, data: { sessionId: updated.id, status: 'SUBMITTED' } };
  }

  /**
   * Evaluate assessment (admin only)
   */
  async evaluateAssessment(sessionId: string, scores: {
    protocolScore: number;
    interpretationScore: number;
    languageScore: number;
    serviceScore: number;
    technicalScore: number;
    criticalError: boolean;
    comments?: string;
  }): Promise<{ success: true; data: any } | { success: false; error: string; code: string }> {
    const identity = await resolveCurrentIdentity();
    if (!identity || identity.role !== 'admin') {
      return { success: false, error: 'Admin access required', code: 'FORBIDDEN' };
    }

    const session = await roleplayRepository.findById(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found', code: 'NOT_FOUND' };
    }

    if (session.status !== 'SUBMITTED' && session.status !== 'UNDER_REVIEW') {
      return { success: false, error: 'Session not available for evaluation', code: 'INVALID_STATE' };
    }

    if (session.qaScoreId) {
      return { success: false, error: 'Session already evaluated', code: 'CONFLICT' };
    }

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
        : 'Ninguna';

    const result = await db.$transaction(async (tx) => {
      // Claim for evaluation (atomic)
      const claimed = await tx.roleplaySession.update({
        where: { 
          id: sessionId,
          status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
          evaluatorId: null,
        },
        data: { 
          evaluatorId: identity.userId,
          status: 'UNDER_REVIEW',
          reviewStartedAt: new Date(),
        },
        select: { id: true },
      });

      if (!claimed) {
        throw new Error('Session already claimed by another evaluator');
      }

      // Create QA score
      const qaScore = await tx.qAScore.create({
        data: {
          interpreterId: session.interpreterId ?? null,
          auditDate: new Date(),
          auditor: identity.email ?? 'System',
          protocolScore: scores.protocolScore,
          interpretationScore: scores.interpretationScore,
          languageScore: scores.languageScore,
          serviceScore: scores.serviceScore,
          technicalScore: scores.technicalScore,
          criticalError: scores.criticalError,
          comentarios: scores.comments,
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

      // Update candidate if applicable
      if (session.recruitmentCandidateId) {
        await tx.recruitmentCandidate.update({
          where: { id: session.recruitmentCandidateId },
          data: { resultRoleplay: Math.round(totalScore) },
        });
      }

      return { qaScoreId: qaScore.id, totalScore: Math.round(totalScore * 100) / 100, actionRequired };
    });

    revalidatePath('/admin/roleplays');
    revalidatePath('/admin/recruitment');
    revalidatePath('/qa');
    revalidatePath('/dashboard/roleplays');

    return { success: true, data: result };
  }

  /**
   * Cancel assessment
   */
  async cancelAssessment(sessionId: string): Promise<{ success: true } | { success: false; error: string; code: string }> {
    const identity = await resolveCurrentIdentity();
    if (!identity || identity.role !== 'admin') {
      return { success: false, error: 'Admin access required', code: 'FORBIDDEN' };
    }

    const session = await roleplayRepository.findById(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found', code: 'NOT_FOUND' };
    }

    if (['PASSED', 'FAILED', 'EVALUATED'].includes(session.status)) {
      return { success: false, error: 'Cannot cancel evaluated session', code: 'INVALID_STATE' };
    }

    await roleplayRepository.transitionStatus(
      sessionId,
      session.status,
      'CANCELLED'
    );

    revalidatePath('/admin/roleplays');
    return { success: true };
  }

  /**
   * Expire assessment (cron job)
   */
  async expireAssessment(sessionId: string): Promise<{ success: true } | { success: false; error: string; code: string }> {
    const session = await roleplayRepository.findById(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found', code: 'NOT_FOUND' };
    }

    if (['PASSED', 'FAILED', 'EVALUATED', 'CANCELLED', 'EXPIRED'].includes(session.status)) {
      return { success: false, error: 'Session already in terminal state', code: 'INVALID_STATE' };
    }

    await roleplayRepository.transitionStatus(
      sessionId,
      session.status,
      'EXPIRED'
    );

    revalidatePath('/admin/roleplays');
    return { success: true };
  }

  /**
   * Map database status + access to roleplay state
   */
  private mapDbStatusToState(dbStatus: string, access: AccessWithToken | null): RoleplayState {
    switch (dbStatus) {
      case 'DRAFT':
        return 'DRAFT';
      case 'PENDING':
      case 'INVITED':
        if (access?.usedAt) {
          return access.startedAt ? 'IN_PROGRESS' : 'STARTED';
        }
        if (access?.validatedAt) {
          return 'STARTED';
        }
        if (access?.expiresAt && access.expiresAt < new Date()) {
          return 'EXPIRED';
        }
        return 'INVITED';
      case 'STARTED':
        return 'STARTED';
      case 'IN_PROGRESS':
        return 'IN_PROGRESS';
      case 'SUBMITTED':
        return 'SUBMITTED';
      case 'UNDER_REVIEW':
        return 'UNDER_REVIEW';
      case 'EVALUATED':
        return 'EVALUATED';
      case 'PASSED':
        return 'PASSED';
      case 'FAILED':
        return 'FAILED';
      case 'EXPIRED':
        return 'EXPIRED';
      case 'CANCELLED':
        return 'CANCELLED';
      default:
        return 'NO_ROLEPLAY';
    }
  }

  /**
   * Get queue for admin evaluation
   */
  async getEvaluationQueue(filters: {
    status?: RoleplayState[];
    page?: number;
    pageSize?: number;
  }) {
    const statusMap: Record<RoleplayState, string[]> = {
      'NO_ROLEPLAY': [],
      'DRAFT': ['DRAFT'],
      'INVITED': ['INVITED'],
      'STARTED': ['STARTED'],
      'IN_PROGRESS': ['IN_PROGRESS'],
      'SUBMITTED': ['SUBMITTED'],
      'UNDER_REVIEW': ['UNDER_REVIEW'],
      'EVALUATED': ['EVALUATED'],
      'PASSED': ['EVALUATED'],
      'FAILED': ['EVALUATED'],
      'EXPIRED': ['EXPIRED'],
      'CANCELLED': ['CANCELLED'],
    };

    const dbStatuses = filters.status?.flatMap(s => statusMap[s] || []) || ['SUBMITTED', 'UNDER_REVIEW'];

    return roleplayRepository.findForQueue({
      status: dbStatuses as any,
      take: filters.pageSize ?? 20,
      skip: ((filters.page ?? 1) - 1) * (filters.pageSize ?? 20),
    });
  }
}

export const roleplayService = new RoleplayService();