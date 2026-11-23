import { describe, expect, it } from 'vitest';
import { parseTimedTranscript, parseTimedTranscriptForReviewWithDiagnostics } from './transcript';

describe('overlapping subtitle reference timeline budget', () => {
  it('measures union coverage, not duplicated speech, for review', () => {
    const samples = Array.from({ length: 32 }, (_value, index) =>
      String(index + 1) + '\n00:00:00,000 --> 00:04:00,000\nDoctor: simultaneous voice'
    ).join('\n\n');
    const result = parseTimedTranscriptForReviewWithDiagnostics(samples);
    expect(result.cues).toHaveLength(32);
    expect(result.diagnostics.overlapping).toBe(31);
    expect(() => parseTimedTranscript(samples)).toThrow();
  });

  it('still rejects any cue beyond the source duration', () => {
    expect(() => parseTimedTranscriptForReviewWithDiagnostics(
      '01:59:59,000 --> 02:00:01,000\nDoctor: Out of bounds',
    )).toThrow(/tiempos/);
  });
});
