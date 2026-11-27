import { describe, expect, it } from 'vitest';
import { parseTimedTranscript, parseTimedTranscriptForReview, parseTimedTranscriptForReviewWithDiagnostics, toPublishableStudioSegments } from './transcript';

describe('Audio Studio offline subtitle import', () => {
  it('imports SRT cues in order and extracts speaker labels', () => {
    const result = parseTimedTranscript(`1
00:00:00,500 --> 00:00:02,000
Doctor: How are you feeling?

2
00:00:02,000 --> 00:00:04,100
Paciente: Me duele el estómago.`);
    expect(result).toEqual([
      { start: 0.5, end: 2, speaker: 'Doctor', text: 'Doctor: How are you feeling?' },
      { start: 2, end: 4.1, speaker: 'Paciente', text: 'Paciente: Me duele el estómago.' },
    ]);
  });

  it.each([',', '.'])('preserves exactly 100 ms cues without admitting 99 ms intervals (%s)', separator => {
    const cue = (end: string) => `00:00:10${separator}000 --> 00:00:10${separator}${end}\nDoctor: Short cue`;
    const raw = cue('100');
    expect(parseTimedTranscript(raw)).toHaveLength(1);
    expect(parseTimedTranscriptForReviewWithDiagnostics(raw)).toEqual({
      cues: [{ start: 10, end: 10.1, text: 'Doctor: Short cue', speaker: 'Doctor' }],
      diagnostics: { reordered: 0, overlapping: 0, divided: 0, skipped: 0 },
    });
    expect(() => parseTimedTranscript(cue('099'))).toThrow();
    const review = parseTimedTranscriptForReviewWithDiagnostics(
      cue('099') + `\n\n00:00:11${separator}000 --> 00:00:12${separator}000\nPatient: Next cue`
    );
    expect(review.cues).toHaveLength(1);
    expect(review.diagnostics.skipped).toBe(1);
  });

  it('imports WebVTT with voice tags and timestamp settings', () => {
    const vtt = `WEBVTT

cue1
00:00:01.000 --> 00:00:02.500 align:start
<v Doctor>Good morning.</v>

cue2
00:00:03.000 --> 00:00:04.000
[Patient] Buenos días.`;
    const result = parseTimedTranscript(vtt);
    expect(result).toEqual([
      { start: 1, end: 2.5, speaker: 'Doctor', text: 'Good morning.' },
      { start: 3, end: 4, speaker: 'Patient', text: '[Patient] Buenos días.' },
    ]);
  });

  it('keeps the first cue when WebVTT header has no blank separator', () => {
    const vtt = `WEBVTT
00:00:00.500 --> 00:00:01.500
<v Doctor>First intervention</v>

00:00:01.500 --> 00:00:02.500
<v Patient>Second intervention</v>`;
    expect(parseTimedTranscript(vtt)).toEqual([
      { start: 0.5, end: 1.5, speaker: 'Doctor', text: 'First intervention' },
      { start: 1.5, end: 2.5, speaker: 'Patient', text: 'Second intervention' },
    ]);
  });

  it('still ignores WebVTT NOTE and STYLE blocks, including embedded arrows', () => {
    const vtt = `WEBVTT

NOTE cue --> this is commentary, not actual timing

STYLE
::cue { color: yellow; }

00:00:01.000 --> 00:00:02.000
<v Doctor>Real cue</v>`;
    expect(parseTimedTranscript(vtt)).toEqual([
      { start: 1, end: 2, speaker: 'Doctor', text: 'Real cue' },
    ]);
  });

  it('does not expose source dialogue to a participant in publishable metadata', () => {
    const cues = parseTimedTranscript(`1
00:00:00,500 --> 00:00:02,000
Doctor: Private medical information goes here.`);
    const publishable = toPublishableStudioSegments(cues);
    expect(publishable).toEqual([
      { title: 'Doctor · 1', start: 0.5, end: 2, scriptPrompt: '', responseLimit: 120 },
    ]);
    expect(JSON.stringify(publishable)).not.toContain('Private medical information');
  });

  it('never copies a real person\'s diarization label into public scenario titles', () => {
    const cues = parseTimedTranscript(`WEBVTT

00:00:00.500 --> 00:00:02.000
<v Dr. Ana Pérez>Private medical dialogue</v>

00:00:02.100 --> 00:00:03.000
Paciente: Me duele la cabeza.

00:00:03.100 --> 00:00:04.000
<v Doctor>What symptoms do you have?</v>`);
    const published = toPublishableStudioSegments(cues);
    expect(published.map(item => item.title)).toEqual([
      'Intervención 1', 'Paciente · 2', 'Doctor · 3',
    ]);
    expect(JSON.stringify(published)).not.toContain('Ana Pérez');
    expect(JSON.stringify(published)).not.toContain('Private medical dialogue');
    expect(JSON.stringify(published)).not.toContain('Me duele');
  });

  it('uses a neutral title for unknown or attacker-controlled speaker labels', () => {
    const published = toPublishableStudioSegments([
      { start: 0, end: 1, speaker: 'Patient John Doe', text: 'Sensitive', },
      { start: 1, end: 2, speaker: '__proto__', text: 'Sensitive', },
      { start: 2, end: 3, speaker: null, text: 'Sensitive', },
    ]);
    expect(published.map(item => item.title)).toEqual([
      'Intervención 1', 'Intervención 2', 'Intervención 3',
    ]);
  });

  it.each([
    ['', 'empty'],
    ['not a transcript', 'no timing'],
    ['00:00:04,000 --> 00:00:03,000\nText', 'reversed'],
    ['00:00:59,999 --> 00:01:60,500\nText', 'invalid seconds'],
    ['00:00:01,000 --> 00:00:02,000\nFirst\n\n00:00:01,900 --> 00:00:03,000\nSecond', 'overlap'],
    ['00:00:00,000 --> 00:05:01,000\nToo long', 'segment duration'],
    [Array.from({ length: 26 }, (_, i) => `${i+1}\n00:${String(i).padStart(2, '0')}:00,000 --> 00:${String(i).padStart(2, '0')}:01,000\nLine`).join('\n\n'), 'too many cues'],
  ])('rejects malformed or unsafe subtitles: %s (%s)', (subtitle) => {
    expect(() => parseTimedTranscript(subtitle)).toThrow();
  });
});


describe('Audio Studio review repairs without weakening strict publishing', () => {
  it('sorts provider cues out of order and retains overlapping timestamps for safe selection', () => {
    const raw = '2\n00:00:02,000 --> 00:00:04,000\nPatient: Second\n\n1\n00:00:01,000 --> 00:00:03,000\nDoctor: First';
    expect(() => parseTimedTranscript(raw)).toThrow(/tiempos/);
    expect(parseTimedTranscriptForReview(raw).map(cue => [cue.start, cue.end])).toEqual([[1, 3], [2, 4]]);
  });

  it('splits an oversized reference cue into bounded, contiguous review windows', () => {
    const raw = '1\n00:00:00,000 --> 00:10:00,000\nDoctor: Source reference';
    expect(() => parseTimedTranscript(raw)).toThrow(/tiempos/);
    expect(parseTimedTranscriptForReview(raw).map(cue => [cue.start, cue.end])).toEqual([[0, 300], [300, 600]]);
  });

  it('still rejects reversed, out-of-source and tiny cues in review mode', () => {
    for (const raw of [
      '00:00:04,000 --> 00:00:03,000\nReversed',
      '02:00:00,000 --> 02:00:01,000\nOutside',
      '00:00:01,000 --> 00:00:01,050\nToo short',
    ]) expect(() => parseTimedTranscriptForReview(raw)).toThrow(/tiempos/);
  });
});


describe('Audio Studio review diagnostic report', () => {
  it('flags repaired input so it cannot silently become a finished roleplay', () => {
    const raw = `WEBVTT

00:05:00.000 --> 00:10:00.001
<v Doctor>Long original reference</v>

00:00:01.000 --> 00:00:04.000
<v Patient>First voice</v>

00:00:02.000 --> 00:00:05.000
<v Doctor>Overlap</v>`;
    const { cues, diagnostics } = parseTimedTranscriptForReviewWithDiagnostics(raw);
    expect(diagnostics).toEqual({ reordered: 1, overlapping: 1, divided: 1, skipped: 0 });
    expect(cues.map(cue => cue.start)).toEqual([1, 2, 300, 450.001]);
    expect(cues.every(cue => cue.end - cue.start <= 300)).toBe(true);
  });

  it('does not flag a clean subtitle file as repaired', () => {
    const { diagnostics } = parseTimedTranscriptForReviewWithDiagnostics(
      '1\n00:00:01,000 --> 00:00:02,000\nDoctor: Hello'
    );
    expect(diagnostics).toEqual({ reordered: 0, overlapping: 0, divided: 0, skipped: 0 });
  });

  it('prevents tiny leftover windows when source duration is barely longer than 300 s', () => {
    const { cues, diagnostics } = parseTimedTranscriptForReviewWithDiagnostics(
      '00:00:00,000 --> 00:05:00,001\nDoctor: Long cue'
    );
    expect(diagnostics.divided).toBe(1);
    expect(cues).toHaveLength(2);
    expect(cues[0].end).toBe(cues[1].start);
    expect(cues.every(cue => cue.end - cue.start >= 0.1)).toBe(true);
  });
});


describe('Provider zero-length and inverted subtitles', () => {
  it('retains valid neighbors for manual review while counting unusable captions', () => {
    const input = [
      '1', '00:00:00,000 --> 00:00:00,050', 'Doctor: Too brief',
      '', '2', '00:00:00,050 --> 00:00:00,200', 'Doctor: Usable',
      '', '3', '00:00:04,000 --> 00:00:03,000', 'Paciente: Inverted',
      '', '4', '00:00:05,000 --> 00:00:06,000', 'Doctor: Usable again',
    ].join('\n');
    expect(() => parseTimedTranscript(input)).toThrow(/subtítulo 1/);
    const result = parseTimedTranscriptForReviewWithDiagnostics(input);
    expect(result.cues.map(cue => [cue.start, cue.end])).toEqual([[0.05, 0.2], [5, 6]]);
    expect(result.diagnostics.skipped).toBe(2);
    expect(result.diagnostics.reordered).toBe(0);
  });

  it('reports out-of-source timestamps with the specific offending cue number', () => {
    const input = [
      '1', '00:00:00,000 --> 00:00:02,000', 'Doctor: Valid',
      '', '2', '02:00:00,000 --> 02:00:01,000', 'Doctor: Invalid',
    ].join('\n');
    expect(() => parseTimedTranscriptForReviewWithDiagnostics(input))
      .toThrow(/subtítulo 2.*posterior al límite/);
  });

  it('does not silently accept an entirely unusable transcript', () => {
    expect(() => parseTimedTranscriptForReviewWithDiagnostics(
      '00:00:01,000 --> 00:00:01,000\nDoctor: Zero duration',
    )).toThrow(/No se encontraron tiempos/);
  });

  it('enforces original cue count even if most captions are skipped', () => {
    const raw = Array.from({ length: 10001 }, () =>
      '00:00:01,000 --> 00:00:01,000\nDoctor: Invalid cue',
    ).join('\n\n');
    expect(() => parseTimedTranscriptForReviewWithDiagnostics(raw)).toThrow(/10000/);
  });
});
