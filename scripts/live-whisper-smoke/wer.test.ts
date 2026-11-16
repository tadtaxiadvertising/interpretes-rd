import { describe, expect, it } from 'vitest';
import { wordErrorRate } from './wer';

describe('Whisper synthetic speech WER calculator', () => {
  it('ignores capitalization, punctuation and Spanish accents', () => {
    expect(wordErrorRate('¡El paciente tiene fiebre!', 'el PACIENTE tiene fiebre.')).toBe(0);
    expect(wordErrorRate('El corazón está bien.', 'el corazon esta bien')).toBe(0);
  });

  it('counts substitutions, deletions, and insertions correctly', () => {
    expect(wordErrorRate('one two three four', 'one FIVE three four')).toBe(0.25);
    expect(wordErrorRate('one two three four', 'one three four')).toBe(0.25);
    expect(wordErrorRate('one two three four', 'one two extra three four')).toBe(0.25);
  });

  it('does not cap hallucinated insertions at 100%', () => {
    expect(wordErrorRate('hello', 'good morning hello I am a doctor')).toBeGreaterThan(1);
    expect(wordErrorRate('hello', '')).toBe(1);
  });

  it('rejects empty reference text rather than claiming accuracy', () => {
    expect(() => wordErrorRate('   ', 'hello')).toThrow('WHISPER_WER_EMPTY_REFERENCE');
  });
});
