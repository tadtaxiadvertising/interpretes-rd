// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  resolveAllowedCorsOrigins,
  isCorsOriginAllowed,
} from '../../../interpreters-api/src/lib/cors-policy';

describe('dedicated Express backend browser CORS boundary', () => {
  it('defaults to only the official frontend in production', () => {
    const allowed = resolveAllowedCorsOrigins(undefined, true);
    expect(allowed).toEqual(['https://interpretes.rd.ibusiness.com.do']);
    expect(isCorsOriginAllowed(allowed[0], allowed, true)).toBe(true);
    expect(isCorsOriginAllowed('https://attacker.example', allowed, true)).toBe(false);
    expect(isCorsOriginAllowed('null', allowed, true)).toBe(false);
    expect(isCorsOriginAllowed(undefined, allowed, true)).toBe(true);
  });

  it('uses an explicit exact-match allowlist with no Origin reflection', () => {
    const allowed = resolveAllowedCorsOrigins(
      'https://interpretes.rd.ibusiness.com.do,https://api.example.test:8443,https://api.example.test:8443',
      true,
    );
    expect(allowed).toHaveLength(2);
    expect(isCorsOriginAllowed('https://api.example.test:8443', allowed, true)).toBe(true);
    expect(isCorsOriginAllowed('https://api.example.test', allowed, true)).toBe(false);
    expect(isCorsOriginAllowed('https://evil.interpretes.rd.ibusiness.com.do', allowed, true)).toBe(false);
  });

  it.each([
    '*', 'null', 'http://external.example',
    'https://operator:secret@example.com',
    'https://example.com/path', 'https://example.com?x=1',
    'https://example.com/#fragment', 'https://example.com\nOrigin: *',
    "https://example.com'; default-src *",
  ])('fails closed on dangerous CORS_ORIGINS (%s)', value => {
    expect(() => resolveAllowedCorsOrigins(value, true)).toThrow('CORS_ORIGINS_INVALID');
  });

  it('keeps localhost HTTP convenient for non-production development only', () => {
    const allowed = resolveAllowedCorsOrigins('http://localhost:3001', false);
    expect(allowed).toEqual(['http://localhost:3001']);
    expect(() => resolveAllowedCorsOrigins('http://localhost:3001', true)).toThrow(
      'CORS_ORIGINS_INVALID',
    );
    expect(isCorsOriginAllowed('http://localhost:3001', [], false)).toBe(true);
    expect(isCorsOriginAllowed('http://localhost:3001', [], true)).toBe(false);
  });

  it('does not embed attacker origins in logged errors', () => {
    const source = readFileSync('interpreters-api/src/app.ts', 'utf8');
    expect(source).toContain("AppError.forbidden('Cross-origin request is not allowed')");
    expect(source).not.toContain('origin: true');
  });
});
