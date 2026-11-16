import { describe, expect, it } from 'vitest';
import { parseTimedTranscriptForReview } from './transcript';

function time(seconds: number) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${h}:${m}:${s},000`;
}

describe('long local video transcript selection', () => {
  it('does not relax legacy SRT limits, but supports a 5h 650-cue reference locally', () => {
    const text = Array.from({ length: 650 }, (_, i) => {
      const start = 4 * 3600 + i * 5;
      return `${i + 1}\n${time(start)} --> ${time(start + 2)}\nDoctor: line ${i + 1}`;
    }).join('\n\n');
    expect(() => parseTimedTranscriptForReview(text)).toThrow();
    const cues = parseTimedTranscriptForReview(text, true);
    expect(cues).toHaveLength(650);
    expect(cues[649].start).toBe(4 * 3600 + 649 * 5);
  });

  it('rejects a cue beyond twelve hours, even in local review mode', () => {
    expect(() => parseTimedTranscriptForReview(
      '1\n12:00:00,000 --> 12:00:01,000\nDoctor: line', true,
    )).toThrow(/tiempos/);
  });
});
