import { describe, expect, it } from 'vitest';
import { normalizeQaV1Points, qaV1StoredTotalMatches } from './qa-v1-score-contract';

describe('legacy QA v1 weighted-point conversion', () => {
  it('converts all five weighted maxima to canonical 100-percent dimensions', () => {
    expect(normalizeQaV1Points({
      protocolScore: 20, interpretationScore: 40, languageScore: 20,
      serviceScore: 10, technicalScore: 10,
    }, false)).toEqual({
      dimensions: {
        protocolScore: 100, interpretationScore: 100, languageScore: 100,
        serviceScore: 100, technicalScore: 100,
      },
      totalScore: 100,
      rawPointTotal: 100,
    });
  });

  it('converts half points to 50 percent, not a doubly weighted score', () => {
    const result = normalizeQaV1Points({
      protocolScore: 10, interpretationScore: 20, languageScore: 10,
      serviceScore: 5, technicalScore: 5,
    }, false);
    expect(result.totalScore).toBe(50);
    expect(Object.values(result.dimensions)).toEqual([50, 50, 50, 50, 50]);
  });

  it('treats missing optional dimensions as zero while preserving other points', () => {
    const result = normalizeQaV1Points({ protocolScore: 5, languageScore: null }, false);
    expect(result.dimensions.protocolScore).toBe(25);
    expect(result.dimensions.languageScore).toBe(0);
    expect(result.totalScore).toBe(5);
  });

  it('rounds stored dimensions to two decimals, like NUMERIC(5,2)', () => {
    const result = normalizeQaV1Points({
      protocolScore: 7.77,
      interpretationScore: 12.35,
    }, false);
    expect(result.dimensions.protocolScore).toBe(38.85);
    expect(result.dimensions.interpretationScore).toBe(30.88);
    expect(result.totalScore).toBe(20.12);
  });

  it('forces total zero for critical error even with perfect dimensions', () => {
    const result = normalizeQaV1Points({
      protocolScore: 20, interpretationScore: 40, languageScore: 20,
      serviceScore: 10, technicalScore: 10,
    }, true);
    expect(result.totalScore).toBe(0);
  });

  it.each([NaN, Infinity, -1, 20.01])('rejects invalid protocol points: %s', (value) => {
    expect(() => normalizeQaV1Points({ protocolScore: value }, false)).toThrow('Invalid QA dimension');
  });

  it('checks persisted Prisma decimals and rejects missing or overwritten trigger results', () => {
    expect(qaV1StoredTotalMatches('100.00', 100)).toBe(true);
    expect(qaV1StoredTotalMatches({ toString: () => '50.00' }, 50)).toBe(true);
    expect(qaV1StoredTotalMatches(50.01, 50)).toBe(true);
    expect(qaV1StoredTotalMatches(26, 100)).toBe(false);
    expect(qaV1StoredTotalMatches(null, 100)).toBe(false);
    expect(qaV1StoredTotalMatches('NaN', 100)).toBe(false);
  });
});
