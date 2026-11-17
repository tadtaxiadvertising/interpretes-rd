import { describe, expect, it } from 'vitest';
import { planGaplessPair } from './gapless-pair-preview';

const a = { start: 10, end: 20, speakerRole: 'doctor', language: 'en' };
const b = { start: 35, end: 45, speakerRole: 'doctor', language: 'en' };

describe('gapless pair audition planner (non-destructive)', () => {
  it('returns two original intervals and reports only the skipped gap', () => {
    expect(planGaplessPair(a, b, 120)).toEqual({
      first: { start: 10, end: 20 },
      second: { start: 35, end: 45 },
      skippedSeconds: 15,
      selectedSeconds: 20,
    });
  });
  it('rejects pauses handled by ordinary merge, overlaps and incompatible speakers', () => {
    expect(planGaplessPair(a, { ...b, start: 21 }, 120)).toBeNull();
    expect(planGaplessPair(a, { ...b, start: 19 }, 120)).toBeNull();
    expect(planGaplessPair(a, { ...b, speakerRole: 'patient' }, 120)).toBeNull();
    expect(planGaplessPair(a, { ...b, language: 'es' }, 120)).toBeNull();
    expect(planGaplessPair({ ...a, speakerRole: 'interpreter' },
      { ...b, speakerRole: 'interpreter' }, 120)).toBeNull();
  });
  it('rejects invalid coordinates and auditions beyond a five-minute potential scene', () => {
    expect(planGaplessPair({ ...a, start: NaN }, b, 120)).toBeNull();
    expect(planGaplessPair(a, { ...b, end: 140 }, 120)).toBeNull();
    expect(planGaplessPair(a, b, 0)).toBeNull();
    expect(planGaplessPair({ ...a, start: 0, end: 160 },
      { ...b, start: 170, end: 320 }, 400)).toBeNull();
  });
});
