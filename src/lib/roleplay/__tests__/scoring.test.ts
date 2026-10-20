import { describe, it, expect } from 'vitest';
import {
  calculateRoleplayScore,
  clampDimensionScore,
  isDimensionScore,
  ROLEPLAY_WEIGHTS,
  ROLEPLAY_PASS_THRESHOLD,
} from '@/lib/roleplay/scoring';

describe('calculateRoleplayScore', () => {
  it('uses the canonical weights (35/40/15/5/5)', () => {
    expect(ROLEPLAY_WEIGHTS).toEqual({
      protocol: 0.35,
      interpretation: 0.4,
      language: 0.15,
      service: 0.05,
      technical: 0.05,
    });
  });

  it('computes the weighted total scaled to 0..100', () => {
    const result = calculateRoleplayScore({
      protocol: 8,
      interpretation: 8.5,
      language: 9,
      service: 8,
      technical: 8.5,
    });
    // 8*0.35 + 8.5*0.40 + 9*0.15 + 8*0.05 + 8.5*0.05 = 8.375 -> 83.75
    expect(result.totalScore).toBe(83.75);
    expect(result.passed).toBe(true);
    expect(result.actionRequired).toBe('Feedback Requerido');
  });

  it('returns 100 for all-max dimensions', () => {
    const result = calculateRoleplayScore({
      protocol: 10,
      interpretation: 10,
      language: 10,
      service: 10,
      technical: 10,
    });
    expect(result.totalScore).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.actionRequired).toBe('Ninguna');
  });

  it('returns 0 for all-min dimensions and marks it failed', () => {
    const result = calculateRoleplayScore({
      protocol: 0,
      interpretation: 0,
      language: 0,
      service: 0,
      technical: 0,
    });
    expect(result.totalScore).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.actionRequired).toBe('Advertencia / Coaching');
  });

  it('forces totalScore to exactly 0 when criticalError is true', () => {
    const result = calculateRoleplayScore({
      protocol: 10,
      interpretation: 10,
      language: 10,
      service: 10,
      technical: 10,
      criticalError: true,
    });
    expect(result.totalScore).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.actionRequired).toBe('Advertencia / Coaching');
  });

  it('treats criticalError false/undefined as normal scoring', () => {
    const base = { protocol: 9, interpretation: 9, language: 9, service: 9, technical: 9 };
    const withFalse = calculateRoleplayScore({ ...base, criticalError: false });
    const without = calculateRoleplayScore(base);
    expect(withFalse.totalScore).toBe(without.totalScore);
    expect(withFalse.totalScore).toBe(90);
  });

  it('applies the pass threshold of 70', () => {
    expect(ROLEPLAY_PASS_THRESHOLD).toBe(70);
    // 7.0 -> exactly 70: passes.
    const atThreshold = calculateRoleplayScore({
      protocol: 7,
      interpretation: 7,
      language: 7,
      service: 7,
      technical: 7,
    });
    expect(atThreshold.totalScore).toBe(70);
    expect(atThreshold.passed).toBe(true);

    // 6.9 across the board -> 69: fails.
    const below = calculateRoleplayScore({
      protocol: 6.9,
      interpretation: 6.9,
      language: 6.9,
      service: 6.9,
      technical: 6.9,
    });
    expect(below.totalScore).toBe(69);
    expect(below.passed).toBe(false);
  });

  it('rounds the total to 2 decimals', () => {
    // 7.3*0.35 + 7.7*0.40 + 7.9*0.15 + 8.1*0.05 + 7.1*0.05
    // = 2.555 + 3.08 + 1.185 + 0.405 + 0.355 = 7.58 -> 75.8
    const result = calculateRoleplayScore({
      protocol: 7.3,
      interpretation: 7.7,
      language: 7.9,
      service: 8.1,
      technical: 7.1,
    });
    expect(result.totalScore).toBe(75.8);
    expect(Number.isInteger(result.totalScore * 100)).toBe(true);
  });

  it('throws RangeError for out-of-range or non-finite dimensions', () => {
    const base = { protocol: 5, interpretation: 5, language: 5, service: 5, technical: 5 };
    expect(() => calculateRoleplayScore({ ...base, protocol: 10.1 })).toThrow(RangeError);
    expect(() => calculateRoleplayScore({ ...base, interpretation: -0.1 })).toThrow(RangeError);
    expect(() => calculateRoleplayScore({ ...base, language: Number.NaN })).toThrow(RangeError);
    expect(() =>
      calculateRoleplayScore({ ...base, service: Number.POSITIVE_INFINITY })
    ).toThrow(RangeError);
  });
});

describe('clampDimensionScore / isDimensionScore', () => {
  it('clamps into 0..10', () => {
    expect(clampDimensionScore(50)).toBe(10);
    expect(clampDimensionScore(-3)).toBe(0);
    expect(clampDimensionScore(7.5)).toBe(7.5);
    expect(clampDimensionScore(Number.NaN)).toBe(0);
  });

  it('validates dimension scores', () => {
    expect(isDimensionScore(0)).toBe(true);
    expect(isDimensionScore(10)).toBe(true);
    expect(isDimensionScore(10.01)).toBe(false);
    expect(isDimensionScore(-1)).toBe(false);
    expect(isDimensionScore('8')).toBe(false);
    expect(isDimensionScore(Number.NaN)).toBe(false);
  });
});
