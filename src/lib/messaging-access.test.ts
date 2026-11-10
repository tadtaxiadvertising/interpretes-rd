import { describe, expect, it } from 'vitest';
import { canAccessChat } from './messaging-access';

describe('chat access policy', () => {
  it('allows admins to chat with admins and interpreters', () => {
    expect(canAccessChat('admin', 'admin')).toBe(true);
    expect(canAccessChat('ADMIN', 'INTERPRETER')).toBe(true);
  });

  it('allows interpreters to chat only with admins', () => {
    expect(canAccessChat('interpreter', 'admin')).toBe(true);
    expect(canAccessChat('INTERPRETER', 'ADMIN')).toBe(true);
    expect(canAccessChat('interpreter', 'interpreter')).toBe(false);
  });

  it('denies candidates, unknown roles, and missing roles', () => {
    expect(canAccessChat('candidate', 'admin')).toBe(false);
    expect(canAccessChat('admin', 'candidate')).toBe(false);
    expect(canAccessChat(null, 'admin')).toBe(false);
    expect(canAccessChat('interpreter', null)).toBe(false);
  });
});
