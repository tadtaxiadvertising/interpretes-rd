import { describe, expect, it } from 'vitest';
import {
  blockingAssignmentStatuses,
  candidateAssignmentScope,
  interpreterAssignmentBatchScope,
  interpreterAssignmentScope,
  ROLEPLAY_ASSIGNMENT_BLOCKING_STATUSES,
} from './roleplay-assignment-ownership';

describe('roleplay creation — candidate ownership wins over legacy interpreter link', () => {
  it('scopes individual interpreter sessions to interpreter-owned history only', () => {
    expect(interpreterAssignmentScope(17)).toEqual({
      interpreterId: 17, recruitmentCandidateId: null,
    });
    expect(candidateAssignmentScope(12)).toEqual({ recruitmentCandidateId: 12 });
  });

  it('uses exactly the same candidate-safe predicate for bulk eligibility queries', () => {
    expect(interpreterAssignmentBatchScope([17, 22])).toEqual({
      interpreterId: { in: [17, 22] },
      recruitmentCandidateId: null,
    });
    expect(interpreterAssignmentBatchScope([])).toEqual({
      interpreterId: { in: [] },
      recruitmentCandidateId: null,
    });
  });

  it('permits resuming individual drafts while preventing bulk duplicates', () => {
    const bulk = blockingAssignmentStatuses(true);
    const single = blockingAssignmentStatuses(false);
    expect(bulk).toEqual([...ROLEPLAY_ASSIGNMENT_BLOCKING_STATUSES]);
    expect(bulk).toContain('DRAFT');
    expect(single).not.toContain('DRAFT');
    expect(single).toContain('INVITED');
    expect(single).toContain('EVALUATED');
    expect(single).toContain('PASSED');
    expect(single).toContain('FAILED');
    expect(single).not.toContain('CANCELLED');
    expect(single).not.toContain('EXPIRED');
    bulk.push('CANCELLED');
    expect(ROLEPLAY_ASSIGNMENT_BLOCKING_STATUSES).not.toContain('CANCELLED');
  });
});
