import { describe, expect, it } from 'vitest';
import { parseTimedTranscript, parseTimedTranscriptForReview } from './transcript';

function timestamp(seconds: number): string {
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  const remaining = String(seconds % 60).padStart(2, '0');
  return hours + ':' + minutes + ':' + remaining + ',000';
}

describe('bounded review of long HappyScribe MP3 captions', () => {
  it('accepts 2000 ordinary cues from a valid two-hour MP3 without publishing them', () => {
    const source = Array.from({ length: 2000 }, (_unused, index) => {
      const start = index * 3;
      return [
        String(index + 1),
        timestamp(start) + ' --> ' + timestamp(start + 2),
        'Doctor: Source cue',
      ].join('\n');
    }).join('\n\n');
    expect(source.length).toBeLessThan(1_000_000);
    const candidates = parseTimedTranscriptForReview(source);
    expect(candidates).toHaveLength(2000);
    expect(candidates[1999].end).toBe(5999);
    expect(() => parseTimedTranscript(source)).toThrow(/25/);
  });

  it('still rejects more than 10000 cues in a one-megabyte SRT file', () => {
    const cue = '00:00:00,000 --> 00:00:00,500\nDoctor: Reference';
    const source = Array.from({ length: 10001 }, () => cue).join('\n\n');
    expect(source.length).toBeLessThan(1_000_000);
    expect(() => parseTimedTranscriptForReview(source)).toThrow(/10000/);
  });

  it('still enforces the two-hour timestamp limit', () => {
    const source = '02:00:00,000 --> 02:00:01,000\nDoctor: Outside';
    expect(() => parseTimedTranscriptForReview(source)).toThrow(/tiempos/);
  });
});
