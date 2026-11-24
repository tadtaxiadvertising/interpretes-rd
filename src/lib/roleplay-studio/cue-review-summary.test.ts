import { describe, expect, it } from 'vitest';
import { cueRequiresEditorialReview, overlappingSelectedTimedCueIndices, summarizeTimedCueReview } from './cue-review-summary';

describe('pre-apply SRT quality summary', () => {
  it('counts unknown speakers, original interpreters and lengthy cues without revealing dialogue', () => {
    const cues = [
      { start: 0, end: 4, speaker: 'Doctor', text: 'Private dialogue' },
      { start: 200, end: 205, speaker: 'Dr. Jane Doe', text: 'Private names' },
      { start: 700, end: 770, speaker: 'Interpreter', text: 'Original interpretation' },
      { start: 1300, end: 1302, speaker: 'Paciente', text: 'Private medical terms' },
    ];
    const data = summarizeTimedCueReview(cues, [0, 1, 2, 3, 3], 1800);
    expect(data).toEqual({
      unknownSpeakers: 1,
      originalInterpreters: 1,
      longCues: 1,
      sourceThirds: 3,
    });
    expect(JSON.stringify(data)).not.toContain('Private');
  });

  it('identifies only flagged selected turns without interpreting private dialogue', () => {
    expect(cueRequiresEditorialReview({
      start: 0, end: 2, speaker: 'Doctor', text: 'Confidential clinical phrase',
    })).toBe(false);
    expect(cueRequiresEditorialReview({
      start: 0, end: 2, speaker: null, text: 'Confidential clinical phrase',
    })).toBe(true);
    expect(cueRequiresEditorialReview({
      start: 0, end: 2, speaker: 'Interpreter', text: 'Confidential clinical phrase',
    })).toBe(true);
    expect(cueRequiresEditorialReview({
      start: 0, end: 61, speaker: 'Paciente', text: 'Confidential clinical phrase',
    })).toBe(true);
    expect(cueRequiresEditorialReview({
      start: 0, end: 60, speaker: 'Paciente', text: 'Confidential clinical phrase',
    })).toBe(false);
  });

  it('reports one or two source thirds for nonrepresentative selections', () => {
    const cues = [
      { start: 1, end: 4, speaker: 'Doctor', text: 'Beginning' },
      { start: 310, end: 315, speaker: 'Paciente', text: 'Middle' },
      { start: 1200, end: 1205, speaker: 'Doctor', text: 'End' },
    ];
    expect(summarizeTimedCueReview(cues, [0, 1], 900).sourceThirds).toBe(2);
    expect(summarizeTimedCueReview(cues, [0], 900).sourceThirds).toBe(1);
  });

  it('ignores bad indexes and does not invent coverage for short or unknown audio', () => {
    const cues = [{ start: 0, end: 2, speaker: null, text: 'Private' }];
    const result = summarizeTimedCueReview(cues, [0, 0, 2, -1, 0.5], 60);
    expect(result).toEqual({
      unknownSpeakers: 1,
      originalInterpreters: 0,
      longCues: 0,
      sourceThirds: null,
    });
    expect(summarizeTimedCueReview(cues, [0], Number.NaN).sourceThirds).toBeNull();
    expect(summarizeTimedCueReview(cues, [], 1000).sourceThirds).toBe(0);
  });
  it('flags every selected cue overlapping a longer selected caption, including nested turns', () => {
    const cues = [
      { start: 0, end: 10, speaker: 'Doctor', text: 'Private conversation A' },
      { start: 1, end: 2, speaker: 'Paciente', text: 'Private conversation B' },
      { start: 5, end: 7, speaker: 'Doctor', text: 'Private conversation C' },
      { start: 10, end: 12, speaker: 'Paciente', text: 'Adjacent, not overlapping' },
      { start: 13, end: 14, speaker: 'Doctor', text: 'Another valid interval' },
    ];
    const selected = [3, 1, 0, 2, 4, 0, -1, 10];
    const result = overlappingSelectedTimedCueIndices(cues, selected);
    expect(result).toEqual([0, 1, 2]);
    expect(selected).toEqual([3, 1, 0, 2, 4, 0, -1, 10]);
    expect(JSON.stringify(result)).not.toContain('Private conversation');
  });

  it('does not flag overlaps with unselected cues or equal boundaries', () => {
    const cues = [
      { start: 0, end: 3, speaker: 'Doctor', text: 'A' },
      { start: 1, end: 2, speaker: 'Paciente', text: 'B' },
      { start: 3, end: 5, speaker: 'Doctor', text: 'C' },
      { start: 5, end: 6, speaker: 'Paciente', text: 'D' },
    ];
    expect(overlappingSelectedTimedCueIndices(cues, [0, 2, 3])).toEqual([]);
    expect(overlappingSelectedTimedCueIndices(cues, [0, 1])).toEqual([0, 1]);
  });

  it('ignores invalid source times and indexes while providing review hints', () => {
    const cues = [
      { start: 0, end: 6, speaker: null, text: 'valid' },
      { start: Number.NaN, end: 5, speaker: null, text: 'invalid' },
      { start: -1, end: 3, speaker: null, text: 'invalid' },
      { start: 4, end: 3, speaker: null, text: 'invalid' },
      { start: 2, end: 4, speaker: null, text: 'valid' },
    ];
    expect(overlappingSelectedTimedCueIndices(cues, [0, 1, 2, 3, 4, 4, 1.5]))
      .toEqual([0, 4]);
  });

});
