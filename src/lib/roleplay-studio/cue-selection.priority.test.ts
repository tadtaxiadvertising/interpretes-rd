import { describe, expect, it } from 'vitest';
import { fillCompatibleTimedCueSelection, selectTimedCues } from './cue-selection';

const overlapping = [
  { start: 0, end: 300, speaker: 'Doctor', text: 'Background caption' },
  { start: 0, end: 2, speaker: 'Patient', text: 'Short first turn' },
  { start: 2, end: 4, speaker: 'Doctor', text: 'Short second turn' },
  { start: 4, end: 6, speaker: 'Patient', text: 'Short third turn' },
  { start: 310, end: 312, speaker: 'Doctor', text: 'Later turn' },
];

describe('Roleplay review suggestion quality', () => {
  it('suggests more non-overlapping turns instead of blocking 5 minutes on the first cue', () => {
    const suggested = fillCompatibleTimedCueSelection(overlapping, [], [0, 1, 2, 3, 4]);
    expect(suggested).toEqual([1, 2, 3, 4]);
    expect(selectTimedCues(overlapping, suggested)).toHaveLength(4);
  });

  it('keeps manually selected long cues unchanged, even if other candidates are shorter', () => {
    const suggested = fillCompatibleTimedCueSelection(overlapping, [0], [1, 2, 3, 4]);
    expect(suggested).toEqual([0, 4]);
  });

  it('does not allow duplicate candidates, interpreter turns, or overflowing 15-minute selections', () => {
    const candidates = [
      { start: 0, end: 280, speaker: 'Doctor', text: 'One' },
      { start: 280, end: 560, speaker: 'Interpreter', text: 'Skip original interpreter' },
      { start: 560, end: 840, speaker: 'Patient', text: 'Two' },
      { start: 840, end: 1120, speaker: 'Doctor', text: 'Three' },
      { start: 1120, end: 1400, speaker: 'Patient', text: 'Four would exceed budget' },
      { start: 1400, end: 1680, speaker: 'Doctor', text: 'Five' },
    ];
    const suggested = fillCompatibleTimedCueSelection(
      candidates, [], [0, 1, 2, 3, 4, 5, 2, -1, 100]
    );
    expect(suggested).toEqual([0, 2, 3]);
    expect(selectTimedCues(candidates, suggested)).toHaveLength(3);
  });
});
