import { describe, expect, it } from 'vitest';
import { parseStudioSilences, suggestStudioClips } from './silence-analysis';

describe('FFmpeg silence log validation for admin editorial cues', () => {
  it('extracts completed silences and trailing silence without exposing FFmpeg log text', () => {
    const log = [
      '[Parsed_silencedetect_0 @ 0x123] silence_start: 2',
      '[Parsed_silencedetect_0 @ 0x123] silence_end: 3.5 | silence_duration: 1.5',
      '[Parsed_silencedetect_0 @ 0x123] silence_start: 7.125',
      '[Parsed_silencedetect_0 @ 0x123] silence_end: 8.25 | silence_duration: 1.125',
      '[Parsed_silencedetect_0 @ 0x123] silence_start: 11',
      'PRIVATE DIAGNOSTIC META: should never become part of response',
    ].join('\n');
    expect(parseStudioSilences(log, 12)).toEqual([
      { start: 2, end: 3.5 },
      { start: 7.125, end: 8.25 },
      { start: 11, end: 12 },
    ]);
  });

  it('ignores malformed and overlapping events instead of returning invalid time ranges', () => {
    const log = [
      'silence_start: -10',
      'silence_end: NaN',
      'silence_start: 0',
      'silence_end: 1.5 | silence_duration: 1.5',
      'silence_start: 0.1',
      'silence_end: 2 | silence_duration: 1.9',
      'silence_start: 15',
    ].join('\n');
    expect(parseStudioSilences(log, 10)).toEqual([{ start: 0, end: 1.5 }]);
    expect(parseStudioSilences(log, 0)).toEqual([]);
    expect(parseStudioSilences('silence_start: 1', 7201)).toEqual([]);
  });

  it('suggests up to 25 bounded, non-overlapping speech intervals', () => {
    const result = suggestStudioClips([{ start: 2, end: 3 }, { start: 7, end: 8 }], 11);
    expect(result).toEqual({ clips: [
      { start: 0, end: 2 },
      { start: 3, end: 7 },
      { start: 8, end: 11 },
    ], omittedCount: 0 });
    expect(suggestStudioClips([{ start: 1, end: 3 }], 3).clips).toEqual([]);
    expect(suggestStudioClips([{ start: 8, end: 9 }, { start: 7, end: 10 }], 12).clips).toEqual([]);
  });

  it('does not silently split overlong dialogue or exceed scenario count/duration budgets', () => {
    expect(suggestStudioClips([{ start: 350, end: 355 }], 710)).toEqual({
      clips: [], omittedCount: 2,
    });
    const shortSilences = Array.from({ length: 40 }, (_, n) => ({
      start: n * 5 + 3,
      end: n * 5 + 4,
    }));
    const r = suggestStudioClips(shortSilences, 210);
    expect(r.clips).toHaveLength(25);
    expect(r.omittedCount).toBeGreaterThan(0);
    expect(r.clips.every(x => x.end > x.start && x.end - x.start <= 300)).toBe(true);
  });
});
