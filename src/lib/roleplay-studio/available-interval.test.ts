import { describe, expect, it } from 'vitest';
import { availableStudioInterval } from './available-interval';

describe('Audio Studio insertion in a long recording', () => {
  it('starts at the playhead when nothing is occupied', () => {
    expect(availableStudioInterval(7200, 3610, []))
      .toEqual({ start: 3610, end: 3640 });
  });

  it('inserts in a gap between distant clips instead of after the last clip', () => {
    expect(availableStudioInterval(7200, 35, [
      { start: 0, end: 30 }, { start: 600, end: 630 },
    ])).toEqual({ start: 35, end: 65 });
  });

  it('advances to the first free region if the cursor is inside a clip', () => {
    expect(availableStudioInterval(100, 5, [
      { start: 0, end: 10 }, { start: 20, end: 50 },
    ])).toEqual({ start: 10, end: 20 });
  });

  it('handles overlapping and unordered existing clips conservatively', () => {
    expect(availableStudioInterval(100, 5, [
      { start: 20, end: 40 }, { start: 0, end: 30 },
    ])).toEqual({ start: 40, end: 70 });
  });

  it('rounds inward and never overlaps millisecond-precision boundaries', () => {
    const interval = availableStudioInterval(5, 1.003, [
      { start: 0, end: 1.001 }, { start: 1.157, end: 5 },
    ]);
    expect(interval).toEqual({ start: 1.01, end: 1.15 });
    expect(interval!.start).toBeGreaterThan(1.001);
    expect(interval!.end).toBeLessThan(1.157);
  });

  it('rejects an insufficient gap and does not silently jump backward', () => {
    expect(availableStudioInterval(100, 99.99, [
      { start: 0, end: 60 },
    ])).toBeNull();
    expect(availableStudioInterval(40, 40, [
      { start: 20, end: 40 },
    ])).toBeNull();
  });

  it('never returns a negative, nonfinite or too-small cut', () => {
    expect(availableStudioInterval(Number.NaN, 0, [])).toBeNull();
    expect(availableStudioInterval(-2, 0, [])).toBeNull();
    expect(availableStudioInterval(0.05, 0, [])).toBeNull();
    expect(availableStudioInterval(70, Number.NaN, [
      { start: Number.NaN, end: 70 },
    ])).toEqual({ start: 0, end: 30 });
  });
});
