import { describe, expect, it } from 'vitest';
import { qaRecentScoreDisplay } from './qa-recent-score-display';

describe('QA history score classification', () => {
  it('does not classify null or missing scores as 0 or critical', () => {
    for (const value of [null, undefined]) {
      expect(qaRecentScoreDisplay(value, false)).toEqual({
        severity: 'unscored', scoreLabel: 'Sin puntuación', criticalLabel: null,
      });
    }
  });

  it('classifies a real zero score as low, not automatically critical', () => {
    expect(qaRecentScoreDisplay(0, false)).toEqual({
      severity: 'low', scoreLabel: '0.00%', criticalLabel: null,
    });
  });

  it('uses the explicit critical flag even for a nonzero historical total', () => {
    expect(qaRecentScoreDisplay(80, true)).toEqual({
      severity: 'critical', scoreLabel: '80.00%', criticalLabel: 'Error crítico',
    });
  });

  it.each([
    [69.99, 'low'],
    [70, 'review'],
    [84.99, 'review'],
    [85, 'excellent'],
    [100, 'excellent'],
  ] as const)('categorizes %s as %s', (score, severity) => {
    expect(qaRecentScoreDisplay(score, false).severity).toBe(severity);
  });

  it('handles Prisma decimal values without losing two-place display precision', () => {
    expect(qaRecentScoreDisplay({ toString: () => '89.50' }, false)).toEqual({
      severity: 'excellent', scoreLabel: '89.50%', criticalLabel: null,
    });
  });

  it('does not display corrupted or nonfinite values as real percentages', () => {
    for (const value of [NaN, Infinity, -5, 105, { toString: () => 'NaN' }]) {
      expect(qaRecentScoreDisplay(value, null).severity).toBe('unscored');
      expect(qaRecentScoreDisplay(value, null).scoreLabel).toBe('Sin puntuación');
    }
  });
});
