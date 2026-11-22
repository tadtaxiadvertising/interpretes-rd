import { describe, expect, it } from 'vitest';
import { happyScribeImportFilename } from './happyscribe-filename';

describe('HappyScribe import filenames', () => {
  it('replaces the extension on Markdown, MP3, SRT and compounded exports', () => {
    expect(happyScribeImportFilename('Procedure.md', 'srt')).toBe('Procedure.srt');
    expect(happyScribeImportFilename('Procedure.mp3', 'mp3')).toBe('Procedure.mp3');
    expect(happyScribeImportFilename('Procedure.mp3.md', 'srt')).toBe('Procedure.srt');
    expect(happyScribeImportFilename('Procedure.MP3.SRT', 'mp3')).toBe('Procedure.mp3');
  });

  it('keeps meaningful periods in titles that have no file extension', () => {
    expect(happyScribeImportFilename('Dr. Smith consult', 'mp3')).toBe('Dr. Smith consult.mp3');
    expect(happyScribeImportFilename('Part 1. Interview', 'srt')).toBe('Part 1. Interview.srt');
  });

  it('does not preserve separators or unsafe OS filename characters', () => {
    expect(happyScribeImportFilename('folder/Case: A\\recording?.md', 'srt'))
      .toBe('folder Case A recording.srt');
    expect(happyScribeImportFilename('  ', 'mp3')).toBe('happyscribe-import.mp3');
  });

  it('bounds both extensions to 180 characters without leaking source text elsewhere', () => {
    for (const extension of ['srt', 'mp3'] as const) {
      const filename = happyScribeImportFilename('A'.repeat(400) + '.md', extension);
      expect(filename.length).toBeLessThanOrEqual(180);
      expect(filename.endsWith('.' + extension)).toBe(true);
      const unicode = happyScribeImportFilename('🎧'.repeat(300) + '.md', extension);
      expect(unicode.length).toBeLessThanOrEqual(180);
      expect(unicode.endsWith('.' + extension)).toBe(true);
      expect(unicode).not.toContain('\uFFFD');
    }
  });
});
