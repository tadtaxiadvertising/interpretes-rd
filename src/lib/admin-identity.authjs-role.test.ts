// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hasAuthoritativeAuthJsRole } from './admin-identity';

describe('authoritative legacy Auth.js session roles', () => {
  it('accepts actual RBAC roles but rejects revoked, missing, or fabricated roles', () => {
    for (const role of ['ADMIN', 'HOLDER', 'INTERPRETER', 'admin', 'holder', 'interpreter']) {
      expect(hasAuthoritativeAuthJsRole(role)).toBe(true);
    }
    for (const role of [undefined, null, '', 'candidate', 'UNKNOWN', 'ADMINISTRATOR', 42, {}, []]) {
      expect(hasAuthoritativeAuthJsRole(role)).toBe(false);
    }
  });
});
