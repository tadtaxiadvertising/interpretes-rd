import type { Prisma, RoleplayStatus } from '@prisma/client';

/**
 * Active interpreter assignments take precedence only when the session has
 * no recruitmentCandidateId. Historical recruitment rows sometimes also
 * retained an interpreterId; they belong exclusively to the candidate.
 */
export const ROLEPLAY_ASSIGNMENT_BLOCKING_STATUSES = [
  'DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED',
  'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED',
] as const satisfies readonly RoleplayStatus[];

export function interpreterAssignmentScope(
  interpreterId: number,
): Prisma.RoleplaySessionWhereInput {
  return { interpreterId, recruitmentCandidateId: null };
}

export function interpreterAssignmentBatchScope(
  interpreterIds: readonly number[],
): Prisma.RoleplaySessionWhereInput {
  return {
    interpreterId: { in: [...interpreterIds] },
    recruitmentCandidateId: null,
  };
}

export function candidateAssignmentScope(
  recruitmentCandidateId: number,
): Prisma.RoleplaySessionWhereInput {
  return { recruitmentCandidateId };
}

/**
 * For explicit single-user assignment a DRAFT can be resumed, while any
 * invited/finished session cannot be overwritten. Bulk assignment and its
 * read-only eligibility preview also exclude DRAFT.
 */
export function blockingAssignmentStatuses(includeDraft: boolean): RoleplayStatus[] {
  return [...ROLEPLAY_ASSIGNMENT_BLOCKING_STATUSES].filter(
    (status) => includeDraft || status !== 'DRAFT',
  );
}
