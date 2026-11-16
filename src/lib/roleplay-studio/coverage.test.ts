import { describe, expect, it } from 'vitest';
import { summarizeStudioCoverage } from './coverage';

describe('local Audio Studio selection coverage', () => {
  it('accounts for skipped time across a twelve-hour recording without decoding audio', () => {
    const summary = summarizeStudioCoverage(43200, [
      { start: 60, end: 80 }, { start: 600, end: 630 },
    ]);
    expect(summary.selectedSeconds).toBe(50);
    expect(summary.excludedSeconds).toBe(43150);
    expect(summary.hasOverlaps).toBe(false);
    expect(summary.gaps).toEqual([
      { start: 0, end: 60, duration: 60 },
      { start: 80, end: 600, duration: 520 },
      { start: 630, end: 43200, duration: 42570 },
    ]);
  });

  it('unions overlapping interventions without counting the same second twice', () => {
    const summary = summarizeStudioCoverage(100, [
      { start: 20, end: 60 },
      { start: 0, end: 30 },
      { start: 60, end: 90 },
    ]);
    expect(summary.selectedSeconds).toBe(90);
    expect(summary.excludedSeconds).toBe(10);
    expect(summary.hasOverlaps).toBe(true);
    expect(summary.gaps).toEqual([{ start: 90, end: 100, duration: 10 }]);
  });

  it('clips out-of-bounds intervals and ignores malformed intervals', () => {
    const summary = summarizeStudioCoverage(60, [
      { start: -10, end: 10 },
      { start: 45, end: 80 },
      { start: NaN, end: 25 },
      { start: 22, end: 18 },
    ]);
    expect(summary.selectedSeconds).toBe(25);
    expect(summary.excludedSeconds).toBe(35);
    expect(summary.gaps).toEqual([{ start: 10, end: 45, duration: 35 }]);
    expect(summary.hasOverlaps).toBe(false);
  });

  it('does not return negative totals for fully covered or invalid sources', () => {
    expect(summarizeStudioCoverage(60, [{ start: 0, end: 60 }]))
      .toEqual({ selectedSeconds: 60, excludedSeconds: 0, gaps: [], hasOverlaps: false });
    expect(summarizeStudioCoverage(NaN, [{ start: 0, end: 60 }]))
      .toEqual({ selectedSeconds: 0, excludedSeconds: 0, gaps: [], hasOverlaps: false });
    expect(summarizeStudioCoverage(0, []))
      .toEqual({ selectedSeconds: 0, excludedSeconds: 0, gaps: [], hasOverlaps: false });
  });
});
