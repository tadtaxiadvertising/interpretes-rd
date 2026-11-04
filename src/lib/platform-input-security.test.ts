import { describe, expect, it } from 'vitest';
import { rejectCredentialLikeText, safeHttpsUrl } from './platform-input-security';

describe('external platform metadata security', () => {
  it('accepts blank and ordinary HTTPS login URLs', () => {
    expect(safeHttpsUrl.safeParse('').success).toBe(true);
    expect(safeHttpsUrl.safeParse('https://portal.example.com/login').success).toBe(true);
  });
  it('rejects insecure or malformed URLs', () => {
    for (const value of ['http://portal.example.com', 'javascript:alert(1)', 'not a url']) {
      expect(safeHttpsUrl.safeParse(value).success).toBe(false);
    }
  });
  it('rejects embedded basic authentication credentials', () => {
    expect(safeHttpsUrl.safeParse('https://user:password@portal.example.com').success).toBe(false);
  });
  it('rejects token-like query keys and fragments', () => {
    for (const value of [
      'https://portal.example.com/?access_token=abc',
      'https://portal.example.com/?api_key=abc',
      'https://portal.example.com/?auth=abc',
      'https://portal.example.com/#token=abc',
    ]) expect(safeHttpsUrl.safeParse(value).success).toBe(false);
  });
  it('rejects obvious credentials in notes', () => {
    expect(rejectCredentialLikeText('password: demo')).toBe(false);
    expect(rejectCredentialLikeText('api_key=123')).toBe(false);
    expect(rejectCredentialLikeText('Access through company portal')).toBe(true);
  });
});
