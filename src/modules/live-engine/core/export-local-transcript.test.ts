import { describe, expect, it } from 'vitest';
import { formatLocalTranscript } from './export-local-transcript';

describe('local transcript TXT export', () => {
  const createdAt = new Date('2026-11-16T06:00:00.000Z');

  it('exports only the final text with language and timestamp', () => {
    const text = formatLocalTranscript({
      transcript: '  Buenos días.\r\n ¿Cómo está?  ',
      language: 'es-ES',
      createdAt,
    });
    expect(text).toBe([
      'Free Interpreters Live',
      'Transcripción local (sin traducción)',
      'Idioma: es-ES',
      'Exportado: 2026-11-16T06:00:00.000Z',
      '',
      'Buenos días.\n ¿Cómo está?',
      '',
    ].join('\n'));
  });

  it('refuses empty or whitespace-only transcripts', () => {
    expect(() => formatLocalTranscript({ transcript: ' \n ', language: 'en-US', createdAt }))
      .toThrow('EMPTY_FINAL_TRANSCRIPT');
  });

  it('rejects invalid timestamps rather than generating malformed filenames', () => {
    expect(() => formatLocalTranscript({ transcript: 'Hello', language: 'en-US', createdAt: new Date('invalid') }))
      .toThrow('INVALID_EXPORT_DATE');
  });
});
