import { describe, expect, it } from 'vitest';
import { summarizeTimedCueReview } from './cue-review-summary';

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
});
