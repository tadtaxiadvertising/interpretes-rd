import { describe, expect, it } from 'vitest';
import { parseTimedTranscript, parseTimedTranscriptForReview } from './transcript';
import { selectTimedCues } from './cue-selection';

function makeSubtitle(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const minutes = Math.floor(index / 60);
    const seconds = index % 60;
    const nextMinutes = Math.floor((index + 1) / 60);
    const nextSeconds = (index + 1) % 60;
    const ts = (m: number, s: number) =>
      `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},000`;
    return `${index + 1}\n${ts(minutes, seconds)} --> ${ts(nextMinutes, nextSeconds)}\nDoctor: Cue ${index + 1}`;
  }).join('\n\n');
}

describe('Long transcript selection for verified roleplay packages', () => {
  it('retains the canonical 25-scenario parser limits for existing callers', () => {
    expect(() => parseTimedTranscript(makeSubtitle(30))).toThrow();
  });

  it('parses up to 500 candidate turns without exporting them until selected', () => {
    const cues = parseTimedTranscriptForReview(makeSubtitle(80));
    expect(cues).toHaveLength(80);
    expect(cues[0].start).toBe(0);
    expect(cues[79].end).toBe(80);
    expect(selectTimedCues(cues, Array.from({ length: 25 }, (_, i) => i))).toHaveLength(25);
    expect(() => selectTimedCues(cues, Array.from({ length: 26 }, (_, i) => i))).toThrow(/25/);
  });

  it('accepts overlapping source captions for review but never exports overlapping selected clips', () => {
    const input = `WEBVTT

00:00:00.000 --> 00:00:03.000
Doctor: First line

00:00:02.000 --> 00:00:05.000
Paciente: Overlapping line

00:00:05.000 --> 00:00:06.000
Doctor: Next line`;
    expect(() => parseTimedTranscript(input)).toThrow();
    const cues = parseTimedTranscriptForReview(input);
    expect(cues).toHaveLength(3);
    expect(() => selectTimedCues(cues, [0, 1])).toThrow(/solapadas/);
    expect(selectTimedCues(cues, [0, 2]).map(cue => cue.start)).toEqual([0, 5]);
  });

  it('rejects corrupt manual selections and transcript size exhaustion', () => {
    const cues = parseTimedTranscriptForReview(makeSubtitle(30));
    expect(() => selectTimedCues(cues, [])).toThrow();
    expect(() => selectTimedCues(cues, [1, 1])).toThrow(/dos veces/);
    expect(() => selectTimedCues(cues, [100])).toThrow(/inexistente/);
    expect(() => selectTimedCues(cues, [-1])).toThrow(/inexistente/);
    expect(() => parseTimedTranscriptForReview(makeSubtitle(501))).toThrow(/500/);
  });

  it('fails if the chosen source turns exceed the 15-minute exported audio budget', () => {
    const cues = Array.from({ length: 4 }, (_, i) => ({
      start: i * 270,
      end: (i + 1) * 270,
      speaker: 'Doctor',
      text: 'Review only',
    }));
    expect(() => selectTimedCues(cues, [0, 1, 2, 3])).toThrow(/15 minutos/);
  });
});
