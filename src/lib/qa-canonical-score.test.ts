import { describe, expect, it } from 'vitest';
import { calculateCanonicalQaTotal } from './qa-canonical-score';

const values = (protocolScore: number, interpretationScore: number,
  languageScore: number, serviceScore: number, technicalScore: number) => ({
  protocolScore, interpretationScore, languageScore, serviceScore, technicalScore,
});

describe('canonical QA weighted total: exact two-decimal arithmetic', () => {
  it('preserves 100, 50 and 0 percent scores', () => {
    expect(calculateCanonicalQaTotal(values(100, 100, 100, 100, 100), false)).toBe(100);
    expect(calculateCanonicalQaTotal(values(50, 50, 50, 50, 50), false)).toBe(50);
    expect(calculateCanonicalQaTotal(values(0, 0, 0, 0, 0), false)).toBe(0);
  });

  it.each([
    [values(6.49, 31.72, 90.83, 46.41, 34.62), 40.26],
    [values(68.88, 50.85, 51.56, 99.91, 42.66), 58.69],
    [values(48.46, 81.07, 58.22, 85.53, 17.58), 64.08],
    [values(86.46, 66.01, 5.95, 67.94, 0.15), 51.70],
  ])('rounds real float half-ties exactly instead of one cent low', (scores, result) => {
    expect(calculateCanonicalQaTotal(scores, false)).toBe(result);
  });

  it('enforces critical-error zero without ignoring input validation', () => {
    expect(calculateCanonicalQaTotal(values(100, 100, 100, 100, 100), true)).toBe(0);
    expect(() => calculateCanonicalQaTotal(values(-1, 100, 100, 100, 100), true))
      .toThrow('Invalid canonical QA percentage');
  });

  it.each([-1, 100.01, 80.005, NaN, Infinity])('rejects invalid percentages: %s', (score) => {
    expect(() => calculateCanonicalQaTotal(values(score, 10, 20, 30, 40), false))
      .toThrow('Invalid canonical QA percentage');
  });

  it('does not mutate input dimensions', () => {
    const input = values(6.49, 31.72, 90.83, 46.41, 34.62);
    const original = { ...input };
    calculateCanonicalQaTotal(input, false);
    expect(input).toEqual(original);
  });
});
