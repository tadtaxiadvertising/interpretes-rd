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
