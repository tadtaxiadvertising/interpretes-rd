import { describe, expect, it } from 'vitest';
import { isValidHappyScribeId } from './happyscribe-id';

describe('HappyScribe API identifiers', () => {
  it('accepts documented 40-hex transcription IDs as well as legacy 32-hex and UUID forms', () => {
    expect(isValidHappyScribeId('e458099e7f8da14f9625854ba7b6a026917ad306')).toBe(true);
    expect(isValidHappyScribeId('a'.repeat(32))).toBe(true);
    expect(isValidHappyScribeId('12345678-1234-1234-1234-1234567890ab')).toBe(true);
    expect(isValidHappyScribeId('B'.repeat(40))).toBe(true);
  });

  it('rejects path injection, non-hex characters and unbounded IDs', () => {
    expect(isValidHappyScribeId('x'.repeat(40))).toBe(false);
    expect(isValidHappyScribeId('a'.repeat(41))).toBe(false);
    expect(isValidHappyScribeId('../transcriptions')).toBe(false);
    expect(isValidHappyScribeId('a'.repeat(32) + '/../../internal')).toBe(false);
    expect(isValidHappyScribeId('')).toBe(false);
  });
});
