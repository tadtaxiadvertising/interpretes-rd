import { describe, expect, it } from 'vitest';
import { selectTimedCues, suggestRepresentativeTimedCueSelection } from './cue-selection';

describe('representative suggestions for long roleplay transcripts', () => {
  it('covers the beginning, middle and end instead of choosing only the earliest 25 turns', () => {
    const cues = Array.from({ length: 650 }, (_, index) => ({
      start: index * 2, end: index * 2 + 1,
      speaker: index % 2 === 0 ? 'Doctor' : 'Paciente',
      text: 'Reference dialogue',
    }));
    const candidates = cues.map((_, index) => index);
    const before = [...candidates];
    const suggested = suggestRepresentativeTimedCueSelection(cues, candidates);
    expect(suggested).toHaveLength(25);
    expect(suggested[0]).toBeLessThan(40);
    expect(suggested.some(index => index >= 260 && index <= 390)).toBe(true);
    expect(suggested.at(-1)).toBeGreaterThan(610);
    expect(selectTimedCues(cues, suggested)).toHaveLength(25);
    expect(candidates).toEqual(before);
  });

  it('prefers short, identified utterances to a long background caption', () => {
    const cues = [
      { start: 0, end: 290, speaker: null, text: 'Provider background caption' },
      ...Array.from({ length: 80 }, (_, index) => ({
        start: index * 4, end: index * 4 + 2,
        speaker: index % 2 === 0 ? 'Doctor' : 'Paciente',
        text: 'Short speech turn',
      })),
    ];
    const picked = suggestRepresentativeTimedCueSelection(cues, cues.map((_, index) => index));
    expect(picked).not.toContain(0);
    expect(selectTimedCues(cues, picked)).toHaveLength(25);
    expect(picked.at(-1)).toBeGreaterThan(70);
  });

  it('skips original interpreter labels and honors the 15-minute package cap', () => {
    const cues = Array.from({ length: 40 }, (_, index) => ({
      start: index * 290, end: index * 290 + 280,
      speaker: index % 7 === 0 ? 'Interpreter' : 'Doctor',
      text: 'Long reference scene',
    }));
    const picked = suggestRepresentativeTimedCueSelection(cues, cues.map((_, index) => index));
    expect(picked).toHaveLength(3);
    expect(picked.every(index => cues[index].speaker !== 'Interpreter')).toBe(true);
    expect(selectTimedCues(cues, picked)).toHaveLength(3);
  });

  it('does not discard compatible short-source turns or invent absent cues', () => {
    const cues = [
      { start: 0, end: 1, speaker: 'Doctor', text: 'First' },
      { start: 0.5, end: 2, speaker: 'Paciente', text: 'Overlapping' },
      { start: 3, end: 4, speaker: 'Interpreter', text: 'Original interpretation' },
      { start: 5, end: 7, speaker: 'Paciente', text: 'Final' },
    ];
    expect(suggestRepresentativeTimedCueSelection(cues, [0, 1, 2, 3]))
      .toEqual([0, 3]);
    expect(suggestRepresentativeTimedCueSelection(cues, [-1, 999]))
      .toEqual([]);
  });
});
