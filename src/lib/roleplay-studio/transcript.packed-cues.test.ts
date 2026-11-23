import { describe, expect, it } from 'vitest';
import { parseTimedTranscript, parseTimedTranscriptForReview } from './transcript';

describe('HappyScribe subtitles without empty cue separators', () => {
  it('retains every numbered SRT turn instead of swallowing subsequent timing lines', () => {
    const input = [
      '1', '00:00:00,500 --> 00:00:02,000', 'Doctor: First line', 'Continues here',
      '2', '00:00:02,000 --> 00:00:03,000', 'Paciente: Second line',
      '3', '00:00:03,000 --> 00:00:04,000', 'Doctor: Third line',
    ].join('\n');
    expect(parseTimedTranscript(input)).toEqual([
      { start: 0.5, end: 2, speaker: 'Doctor', text: 'Doctor: First line Continues here' },
      { start: 2, end: 3, speaker: 'Paciente', text: 'Paciente: Second line' },
      { start: 3, end: 4, speaker: 'Doctor', text: 'Doctor: Third line' },
    ]);
  });

  it('accepts packed WebVTT with cue identifiers and a header', () => {
    const input = [
      'WEBVTT', 'cue1', '00:00:01.000 --> 00:00:02.000', '<v Doctor>Hello</v>',
      'cue2', '00:00:02.000 --> 00:00:03.000', '<v Patient>Hi</v>',
    ].join('\n');
    expect(parseTimedTranscript(input).map(c => [c.start, c.end, c.speaker, c.text]))
      .toEqual([[1, 2, 'Doctor', 'Hello'], [2, 3, 'Patient', 'Hi']]);
  });

  it('handles unnumbered packed captions without deleting text', () => {
    const input = [
      '00:00:00,000 --> 00:00:01,000', 'Doctor: First', '2',
      '00:00:01,000 --> 00:00:02,000', 'Patient: Second',
    ].join('\n');
    expect(parseTimedTranscript(input).map(c => c.text))
      .toEqual(['Doctor: First 2', 'Patient: Second']);
  });

  it('keeps strict overlap rejection while allowing chronological review', () => {
    const input = [
      '1', '00:00:02,000 --> 00:00:04,000', 'Patient: Second',
      '2', '00:00:01,000 --> 00:00:03,000', 'Doctor: First',
    ].join('\n');
    expect(() => parseTimedTranscript(input)).toThrow(/tiempos/);
    expect(parseTimedTranscriptForReview(input).map(c => c.start)).toEqual([1, 2]);
  });

  it('continues to ignore NOTE metadata containing timestamp-looking lines', () => {
    const input = [
      'WEBVTT', '', 'NOTE external note',
      '00:00:00.000 --> 00:00:01.000', '', 
      '00:00:02.000 --> 00:00:03.000', '<v Doctor>Real dialogue</v>',
    ].join('\n');
    expect(parseTimedTranscript(input).map(c => c.text)).toEqual(['Real dialogue']);
  });
});
