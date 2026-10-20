/**
 * Recruitment application state machine.
 *
 * Single source of truth for which RecruitmentApplicationStatus transitions
 * are legal, which RecruitmentStep each status maps to, and how to advance an
 * application atomically (optimistic version guard + RecruitmentEvent audit).
 *
 * All pipeline writers (roleplay milestones, step completions, hiring) MUST
 * go through advanceApplication() instead of mutating status directly.
 */

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type {
  RecruitmentApplicationStatus,
  RecruitmentEventType,
  RecruitmentStep,
} from '@/lib/prisma-types';

/** Statuses from which no further transition is allowed. */
export const TERMINAL_STATUSES: readonly RecruitmentApplicationStatus[] = [
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
];

/** Canonical step shown for each status. */
export const STATUS_TO_STEP: Record<RecruitmentApplicationStatus, RecruitmentStep> = {
  APPLIED: 'APPLICATION',
  PROFILE_PENDING: 'PROFILE',
  DOCUMENTS_PENDING: 'DOCUMENTS',
  LANGUAGE_PENDING: 'LANGUAGE',
  TECHNICAL_PENDING: 'TECHNICAL',
  INDUCTION_PENDING: 'INDUCTION',
  ROLEPLAY_PENDING: 'ROLEPLAY',
  ROLEPLAY_IN_PROGRESS: 'ROLEPLAY',
  ROLEPLAY_REVIEW: 'ROLEPLAY_REVIEW',
  INTERVIEW_PENDING: 'INTERVIEW',
  INTERVIEW_SCHEDULED: 'INTERVIEW',
  INTERVIEW_REVIEW: 'INTERVIEW',
  OFFER_PENDING: 'DECISION',
  OFFER_SENT: 'OFFER',
  OFFER_ACCEPTED: 'OFFER',
  CONTRACT_PENDING: 'CONTRACT',
  BANKING_PENDING: 'BANKING',
  TECH_SETUP_PENDING: 'TECH_SETUP',
  TRAINING_PENDING: 'TRAINING',
  READY_FOR_ACTIVATION: 'READY_FOR_ACTIVATION',
  HIRING: 'HIRING',
  HIRED: 'HIRING',
  REJECTED: 'APPLICATION',
  WITHDRAWN: 'APPLICATION',
  EXPIRED: 'APPLICATION',
};

/**
 * Admin fast-track edges: every open, pre-activation status may be sent
 * straight to READY_FOR_ACTIVATION by `markApplicationReadyAction`. This
 * mirrors the pre-existing permissive admin bridge (any non-closed,
 * non-activation status) so routing the action through this machine does
 * not change what an admin can do. Activation statuses
 * (READY_FOR_ACTIVATION, HIRING) and terminal statuses are excluded.
 */
export const PRE_ACTIVATION_STATUSES: readonly RecruitmentApplicationStatus[] = [
  'APPLIED',
  'PROFILE_PENDING',
  'DOCUMENTS_PENDING',
  'LANGUAGE_PENDING',
  'TECHNICAL_PENDING',
  'INDUCTION_PENDING',
  'ROLEPLAY_PENDING',
  'ROLEPLAY_IN_PROGRESS',
  'ROLEPLAY_REVIEW',
  'INTERVIEW_PENDING',
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_REVIEW',
  'OFFER_PENDING',
  'OFFER_SENT',
  'OFFER_ACCEPTED',
  'CONTRACT_PENDING',
  'BANKING_PENDING',
  'TECH_SETUP_PENDING',
  'TRAINING_PENDING',
];

/**
 * Legal transitions. Rejection/withdrawal/expiry are allowed from any
 * non-terminal status; correction loops keep the same status (handled as an
 * idempotent no-op by advanceApplication, not listed here).
 *
 * Repair edges kept for compatibility with best-effort pipeline bookkeeping
 * are marked; call sites further restrict with `fromStatuses`.
 *
 * Every PRE_ACTIVATION_STATUSES member additionally allows
 * READY_FOR_ACTIVATION (admin fast-track) and READY_FOR_ACTIVATION allows a
 * direct HIRED (hireCandidate historically skipped the HIRING step).
 */
export const APPLICATION_TRANSITIONS: Record<
  RecruitmentApplicationStatus,
  readonly RecruitmentApplicationStatus[]
> = {
  // Live funnel today: APPLIED -> ROLEPLAY_* directly; full chain also allowed.
  APPLIED: [
    'PROFILE_PENDING',
    'DOCUMENTS_PENDING',
    'LANGUAGE_PENDING',
    'TECHNICAL_PENDING',
    'INDUCTION_PENDING',
    'ROLEPLAY_PENDING',
    'ROLEPLAY_IN_PROGRESS',
    'ROLEPLAY_REVIEW',
    'READY_FOR_ACTIVATION',
    'REJECTED',
    'WITHDRAWN',
    'EXPIRED',
  ],
  PROFILE_PENDING: ['DOCUMENTS_PENDING', 'READY_FOR_ACTIVATION', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  DOCUMENTS_PENDING: ['LANGUAGE_PENDING', 'READY_FOR_ACTIVATION', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  LANGUAGE_PENDING: ['TECHNICAL_PENDING', 'READY_FOR_ACTIVATION', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  TECHNICAL_PENDING: ['INDUCTION_PENDING', 'READY_FOR_ACTIVATION', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  // INDUCTION_PENDING -> ROLEPLAY_REVIEW mirrors the legacy live path where a
  // submitted roleplay can outlive lagged induction bookkeeping.
  INDUCTION_PENDING: [
    'ROLEPLAY_PENDING',
    'ROLEPLAY_IN_PROGRESS',
    'ROLEPLAY_REVIEW',
    'READY_FOR_ACTIVATION',
    'REJECTED',
    'WITHDRAWN',
    'EXPIRED',
  ],
  ROLEPLAY_PENDING: [
    'ROLEPLAY_IN_PROGRESS',
    'ROLEPLAY_REVIEW',
    'READY_FOR_ACTIVATION',
    'REJECTED',
    'WITHDRAWN',
    'EXPIRED',
  ],
  ROLEPLAY_IN_PROGRESS: [
    'ROLEPLAY_PENDING',
    'ROLEPLAY_REVIEW',
    // Repair: evaluation finished while submit bookkeeping lagged.
    'INTERVIEW_PENDING',
    'READY_FOR_ACTIVATION',
    'REJECTED',
    'WITHDRAWN',
    'EXPIRED',
  ],
  ROLEPLAY_REVIEW: [
    // Explicit retry policy: re-invite for another roleplay session.
    'ROLEPLAY_PENDING',
    'INTERVIEW_PENDING',
    'READY_FOR_ACTIVATION',
    'REJECTED',
    'WITHDRAWN',
    'EXPIRED',
  ],
  INTERVIEW_PENDING: ['INTERVIEW_SCHEDULED', 'READY_FOR_ACTIVATION', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  INTERVIEW_SCHEDULED: [
    'INTERVIEW_REVIEW',
    'INTERVIEW_PENDING',
    'READY_FOR_ACTIVATION',
    'REJECTED',
    'WITHDRAWN',
    'EXPIRED',
  ],
  INTERVIEW_REVIEW: [
    'OFFER_PENDING',
    'ROLEPLAY_PENDING',
    'READY_FOR_ACTIVATION',
    'REJECTED',
    'WITHDRAWN',
    'EXPIRED',
  ],
  OFFER_PENDING: ['OFFER_SENT', 'READY_FOR_ACTIVATION', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  OFFER_SENT: ['OFFER_ACCEPTED', 'READY_FOR_ACTIVATION', 'REJECTED', 'EXPIRED'],
  OFFER_ACCEPTED: ['CONTRACT_PENDING', 'READY_FOR_ACTIVATION', 'REJECTED', 'WITHDRAWN'],
  CONTRACT_PENDING: ['BANKING_PENDING', 'READY_FOR_ACTIVATION', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  BANKING_PENDING: ['TECH_SETUP_PENDING', 'READY_FOR_ACTIVATION', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  TECH_SETUP_PENDING: ['TRAINING_PENDING', 'READY_FOR_ACTIVATION', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  TRAINING_PENDING: ['READY_FOR_ACTIVATION', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  // Direct READY_FOR_ACTIVATION -> HIRED keeps hireCandidate's historical
  // single-step hire; HIRING remains the explicit intermediate state.
  READY_FOR_ACTIVATION: ['HIRING', 'HIRED', 'TRAINING_PENDING', 'REJECTED', 'WITHDRAWN'],
  HIRING: ['HIRED'],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: [],
  EXPIRED: [],
};

export function isTerminalStatus(status: RecruitmentApplicationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** True when `from -> to` is a legal transition (same-status is not a transition). */
export function canTransition(
  from: RecruitmentApplicationStatus,
  to: RecruitmentApplicationStatus
): boolean {
  if (from === to) return false;
  return (APPLICATION_TRANSITIONS[from] ?? []).includes(to);
}

export type AdvanceApplicationActorType = 'candidate' | 'admin' | 'system';

export type AdvanceApplicationParams = {
  /** Target application. Provide exactly one of applicationId or candidateId. */
  applicationId?: string;
  candidateId?: number;
  /**
   * Extra guard: the application's current status must be in this list.
   * Combined with (not replaced by) the state-machine check.
   */
  fromStatuses?: readonly RecruitmentApplicationStatus[];
  toStatus: RecruitmentApplicationStatus;
  /** Defaults to STATUS_TO_STEP[toStatus]. */
  toStep?: RecruitmentStep;
  eventType: RecruitmentEventType;
  actorType: AdvanceApplicationActorType;
  actorId: string;
  /** Optional optimistic-concurrency token in addition to the loaded version. */
  expectedVersion?: number;
  metadata?: Prisma.InputJsonValue;
  /** Run inside an existing transaction instead of opening a new one. */
  db?: Prisma.TransactionClient;
};

export type AdvanceApplicationSuccess = {
  success: true;
  data: {
    applicationId: string;
    fromStatus: RecruitmentApplicationStatus;
    toStatus: RecruitmentApplicationStatus;
    version: number;
    /** False when the application was already in toStatus (idempotent retry). */
    advanced: boolean;
  };
};

export type AdvanceApplicationFailure = {
  success: false;
  error: string;
  code: 'NOT_FOUND' | 'INVALID_STATE' | 'CONFLICT' | 'VALIDATION_ERROR';
};

export type AdvanceApplicationResult = AdvanceApplicationSuccess | AdvanceApplicationFailure;

type TransitionClient = Prisma.TransactionClient;

function selectApplication(
  client: TransitionClient,
  params: Pick<AdvanceApplicationParams, 'applicationId' | 'candidateId'>
) {
  if (params.applicationId !== undefined && params.candidateId !== undefined) {
    return Promise.resolve(null);
  }
  if (params.applicationId !== undefined) {
    return client.recruitmentApplication.findUnique({
      where: { id: params.applicationId },
      select: { id: true, status: true, version: true },
    });
  }
  if (params.candidateId !== undefined) {
    return client.recruitmentApplication.findUnique({
      where: { candidateId: params.candidateId },
      select: { id: true, status: true, version: true },
    });
  }
  return Promise.resolve(null);
}

/**
 * Atomically advances a recruitment application.
 *
 * - Validates the transition against the state machine (plus optional
 *   fromStatuses guard).
 * - Idempotent: a retry that finds the application already in toStatus
 *   succeeds without writing or duplicating the event.
 * - Concurrency-safe: the UPDATE is guarded by the loaded status and version;
 *   a lost race returns CONFLICT instead of overwriting.
 * - Every real transition appends a RecruitmentEvent in the same transaction.
 */
export async function advanceApplication(
  params: AdvanceApplicationParams
): Promise<AdvanceApplicationResult> {
  if (params.applicationId === undefined && params.candidateId === undefined) {
    return {
      success: false,
      error: 'Either applicationId or candidateId is required',
      code: 'VALIDATION_ERROR',
    };
  }
  if (params.applicationId !== undefined && params.candidateId !== undefined) {
    return {
      success: false,
      error: 'Provide applicationId or candidateId, not both',
      code: 'VALIDATION_ERROR',
    };
  }

  const run = async (client: TransitionClient): Promise<AdvanceApplicationResult> => {
    const application = await selectApplication(client, params);
    if (!application) {
      return { success: false, error: 'Recruitment application not found', code: 'NOT_FOUND' };
    }

    // Idempotent retry: already in the target status.
    if (application.status === params.toStatus) {
      return {
        success: true,
        data: {
          applicationId: application.id,
          fromStatus: application.status,
          toStatus: params.toStatus,
          version: application.version,
          advanced: false,
        },
      };
    }

    if (!canTransition(application.status, params.toStatus)) {
      return {
        success: false,
        error: `Invalid transition ${application.status} -> ${params.toStatus}`,
        code: 'INVALID_STATE',
      };
    }

    if (params.fromStatuses && !params.fromStatuses.includes(application.status)) {
      return {
        success: false,
        error: `Application is ${application.status}, expected one of [${params.fromStatuses.join(', ')}]`,
        code: 'INVALID_STATE',
      };
    }

    const expectedVersion = params.expectedVersion ?? application.version;
    const updated = await client.recruitmentApplication.updateMany({
      where: {
        id: application.id,
        status: application.status,
        version: expectedVersion,
      },
      data: {
        status: params.toStatus,
        currentStep: params.toStep ?? STATUS_TO_STEP[params.toStatus],
        version: { increment: 1 },
        lastActivityAt: new Date(),
        lastActorId: params.actorId,
      },
    });

    if (updated.count === 0) {
      // A concurrent transition won the race; the caller may re-read and retry.
      return {
        success: false,
        error: 'Concurrent transition detected; application changed while advancing',
        code: 'CONFLICT',
      };
    }

    await client.recruitmentEvent.create({
      data: {
        applicationId: application.id,
        eventType: params.eventType,
        fromStatus: application.status,
        toStatus: params.toStatus,
        actorType: params.actorType,
        actorId: params.actorId,
        ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
      },
    });

    return {
      success: true,
      data: {
        applicationId: application.id,
        fromStatus: application.status,
        toStatus: params.toStatus,
        version: expectedVersion + 1,
        advanced: true,
      },
    };
  };

  if (params.db) {
    return run(params.db);
  }
  return prisma.$transaction((tx) => run(tx));
}
