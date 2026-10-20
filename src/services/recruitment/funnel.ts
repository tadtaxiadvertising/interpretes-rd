/**
 * Canonical mapping between the persisted recruitment state and the 4-step
 * public funnel rendered by /postular.
 *
 * This module is intentionally free of Prisma/server imports so the same
 * source of truth can be reasoned about (and tested) without a database.
 * Callers must feed it the persisted statuses only; never a client value.
 */

import type { RecruitmentApplicationStatus } from '@/lib/prisma-types';

export const FUNNEL_STEP_APPLICATION = 1;
export const FUNNEL_STEP_INDUCTION = 2;
export const FUNNEL_STEP_ROLEPLAY = 3;
export const FUNNEL_STEP_SETUP = 4;

/** Roleplay states where the candidate has already submitted for review. */
export const ROLEPLAY_SUBMITTED_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'EVALUATED',
  'PASSED',
  'FAILED',
] as const;

const TERMINAL_STATUSES: readonly RecruitmentApplicationStatus[] = [
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
];

const INDUCTION_STATUSES: readonly RecruitmentApplicationStatus[] = [
  'APPLIED',
  'PROFILE_PENDING',
  'DOCUMENTS_PENDING',
  'LANGUAGE_PENDING',
  'TECHNICAL_PENDING',
  'INDUCTION_PENDING',
];

const ROLEPLAY_STATUSES: readonly RecruitmentApplicationStatus[] = [
  'ROLEPLAY_PENDING',
  'ROLEPLAY_IN_PROGRESS',
  'ROLEPLAY_REVIEW',
];

export function isApplicationTerminal(status: RecruitmentApplicationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Funnel step for an application with no roleplay session yet.
 * Everything from the interview stage onward is represented by the final
 * "setup" step; terminal applications stay on the last step but are flagged
 * as terminal so the portal can stop inviting action.
 */
export function funnelStepForStatus(status: RecruitmentApplicationStatus): number {
  if (INDUCTION_STATUSES.includes(status)) return FUNNEL_STEP_INDUCTION;
  if (ROLEPLAY_STATUSES.includes(status)) return FUNNEL_STEP_ROLEPLAY;
  return FUNNEL_STEP_SETUP;
}

/**
 * Authoritative funnel step derived from persisted state.
 *
 * A roleplay session in progress always wins over stale application
 * bookkeeping; a submitted roleplay moves the candidate to the setup step.
 * Without a session, the application status decides.
 */
export function deriveFunnelStep(
  applicationStatus: RecruitmentApplicationStatus | null | undefined,
  latestRoleplayStatus: string | null | undefined
): number {
  if (latestRoleplayStatus) {
    return (ROLEPLAY_SUBMITTED_STATUSES as readonly string[]).includes(latestRoleplayStatus)
      ? FUNNEL_STEP_SETUP
      : FUNNEL_STEP_ROLEPLAY;
  }
  if (!applicationStatus) return FUNNEL_STEP_INDUCTION;
  return funnelStepForStatus(applicationStatus);
}
