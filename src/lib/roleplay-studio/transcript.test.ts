import { describe, expect, it } from 'vitest';
import { parseTimedTranscript, toPublishableStudioSegments } from './transcript';

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
