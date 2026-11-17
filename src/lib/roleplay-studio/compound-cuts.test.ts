import { describe, expect, it } from 'vitest';
import { studioSelectedSeconds, validStudioRanges } from './compound-cuts';

const compound = {
  start: 10, end: 47,
  ranges: [{ start: 10, end: 20 }, { start: 40, end: 47 }],
};

describe('v2 physical gapless scene boundaries', () => {
  it('preserves legacy single clips and returns physical selected duration', () => {
    expect(validStudioRanges({ start: 5, end: 12 }, 60)).toEqual([{ start: 5, end: 12 }]);
    const cuts = validStudioRanges(compound, 60)!;
    expect(cuts).toEqual(compound.ranges);
    expect(studioSelectedSeconds(cuts)).toBe(17);
    expect(compound.end - compound.start).toBe(37);
  });

  it('rejects malformed, overlapping, forged and too many intervals', () => {
    const variants: unknown[] = [
      [], [{ start: 10, end: 20 }],
      [{ start: 10, end: 20 }, { start: 40, end: 47 }, { start: 55, end: 56 }],
      [{ start: 10, end: 20 }, { start: 19, end: 47 }],
      [{ start: 10, end: 20 }, { start: 22, end: 47 }],
      [{ start: 10, end: NaN }, { start: 40, end: 47 }],
      [{ start: -1, end: 20 }, { start: 40, end: 47 }],
      [{ start: 10, end: 20 }, { start: 40, end: 70 }],
      [{ start: 10, end: 20 }, { start: 40, end: 47.2 }],
    ];
    for (const ranges of variants) {
      expect(validStudioRanges({ ...compound, ranges }, 60)).toBeNull();
    }
    expect(validStudioRanges({ ...compound, start: 9 }, 60)).toBeNull();
    expect(validStudioRanges({ ...compound, end: 48 }, 60)).toBeNull();
    expect(validStudioRanges({ start: 0, end: 400,
      ranges: [{ start: 0, end: 170 }, { start: 200, end: 400 }] }, 430)).toBeNull();
  });
});
