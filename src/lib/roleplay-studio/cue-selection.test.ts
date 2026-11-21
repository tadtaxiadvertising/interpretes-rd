import { describe, expect, it } from 'vitest';
import { parseTimedTranscript, parseTimedTranscriptForReview } from './transcript';
import { selectTimedCues, fillCompatibleTimedCueSelection } from './cue-selection';

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


  it('suggests nonoverlapping cues but never auto-picks a labeled interpreter', () => {
    const cues = [
      { start: 0, end: 3, text: 'Doctor 1', speaker: 'Doctor' },
      { start: 2, end: 4, text: 'Overlap', speaker: 'Patient' },
      { start: 4, end: 6, text: 'Interpretation', speaker: 'Interpreter' },
      { start: 6, end: 8, text: 'Patient', speaker: 'Paciente' },
      { start: 9, end: 11, text: 'Unknown', speaker: null },
    ];
    expect(fillCompatibleTimedCueSelection(cues, [], [0, 1, 2, 3, 4]))
      .toEqual([0, 3, 4]);
    expect(selectTimedCues(cues, [0, 3, 4])).toHaveLength(3);
    // An administrator's already selected valid choices remain untouched.
    expect(fillCompatibleTimedCueSelection(cues, [1], [0, 2, 3, 4]))
      .toEqual([1, 3, 4]);
    expect(() => fillCompatibleTimedCueSelection(cues, [0, 1], [3]))
      .toThrow(/solapadas/);
  });

  it('obeys 25 scenarios and 15 minutes even when selecting across many pages', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      start: index * 10, end: index * 10 + 3,
      speaker: 'Doctor', text: 'Cue',
    }));
    const picked = fillCompatibleTimedCueSelection(many, [], many.map((_, i) => i));
    expect(picked).toEqual(Array.from({ length: 25 }, (_, i) => i));
    const long = Array.from({ length: 8 }, (_, index) => ({
      start: index * 300, end: index * 300 + 280,
      speaker: 'Doctor', text: 'Cue',
    }));
    expect(fillCompatibleTimedCueSelection(long, [], long.map((_, i) => i)))
      .toEqual([0, 1, 2]);
    expect(selectTimedCues(long, [0, 1, 2])).toHaveLength(3);
  });

  it('does not mutate manual selections or candidate lists', () => {
    const cues = parseTimedTranscriptForReview(makeSubtitle(30));
    const chosen = [9, 2];
    const visible = [11, 10, 2, 9];
    expect(fillCompatibleTimedCueSelection(cues, chosen, visible)).toEqual([2, 9, 10, 11]);
    expect(chosen).toEqual([9, 2]);
    expect(visible).toEqual([11, 10, 2, 9]);
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
