import { describe, expect, it } from 'vitest';
import { proposeLocalVadCuts } from './vad-suggestions';

const activity = (start: number, end: number) => ({ start, end, signalLevel: 0.6 });

describe('local VAD proposals for existing roleplay edits', () => {
  it('merges padded overlapping activity and omits windows inside existing turns', () => {
    const result = proposeLocalVadCuts([
      activity(2, 5.5), activity(5.45, 7.2),
      activity(30, 33), activity(50, 52),
    ], 120, [{ start: 29, end: 35 }]);
    expect(result).toEqual({
      clips: [{ start: 2, end: 7.2 }, { start: 50, end: 52 }],
      omittedCount: 1,
    });
  });

  it('never cuts through a prior intervention or overflows 25 slots', () => {
    const previous = Array.from({ length: 24 }, (_, i) => ({
      start: i * 5,
      end: i * 5 + 2,
    }));
    const result = proposeLocalVadCuts([
      activity(121, 124), activity(130, 133),
    ], 240, previous);
    expect(result.clips).toEqual([{ start: 121, end: 124 }]);
    expect(result.omittedCount).toBe(1);
  });

  it('rounds inward and ignores tiny signal events instead of inventing clips', () => {
    const result = proposeLocalVadCuts([
      activity(1.001, 2.261), activity(4, 4.5),
    ], 6, []);
    expect(result.clips).toEqual([{ start: 1.01, end: 2.26 }]);
    expect(result.omittedCount).toBe(1);
  });

  it('reports no cuts for silence and rejects unsafe metadata', () => {
    expect(proposeLocalVadCuts([], 60, [])).toEqual({ clips: [], omittedCount: 0 });
    expect(proposeLocalVadCuts([activity(0, 10)], 241, []).clips).toEqual([]);
    expect(proposeLocalVadCuts([activity(-1, 10)], 60, []).clips).toEqual([]);
    expect(proposeLocalVadCuts([activity(0, Number.NaN)], 60, []).clips).toEqual([]);
    expect(proposeLocalVadCuts([activity(2, 10)], 60, [
      { start: -1, end: 20 },
    ]).clips).toEqual([]);
  });
});
