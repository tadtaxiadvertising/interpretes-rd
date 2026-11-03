import { describe, expect, it } from 'vitest';
import { hasCompleteRoleplaySelfAssessment } from '../self-assessment';

describe('hasCompleteRoleplaySelfAssessment', () => {
  it('accepts all five numeric rubric dimensions', () => {
    expect(hasCompleteRoleplaySelfAssessment({
      protocol: 8,
      interpretation: 9,
      language: 8,
      service: 10,
      technical: 7,
      criticalError: false,
    })).toBe(true);
  });

  it('rejects a legacy partial score object', () => {
    expect(hasCompleteRoleplaySelfAssessment({ fluency: 8, pronunciation: 7 })).toBe(false);
    expect(hasCompleteRoleplaySelfAssessment({ protocol: 8, interpretation: 9 })).toBe(false);
  });

  it('rejects missing, malformed, and non-numeric dimensions', () => {
    expect(hasCompleteRoleplaySelfAssessment(null)).toBe(false);
    expect(hasCompleteRoleplaySelfAssessment([])).toBe(false);
    expect(hasCompleteRoleplaySelfAssessment({
      protocol: 8, interpretation: 9, language: 8, service: 10, technical: '7',
    })).toBe(false);
  });
});
