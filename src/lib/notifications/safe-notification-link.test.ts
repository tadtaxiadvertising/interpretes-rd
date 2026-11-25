import { describe, expect, it } from 'vitest';
import { safeNotificationLink } from './safe-notification-link';

describe('safe notification links', () => {
  it.each(['/dashboard', '/admin/roleplays/studio', '/qa', '/dashboard/roleplays/abc-123'])('allows module path %s', path => {
    expect(safeNotificationLink(path)).toBe(path);
  });
  it('strips query and fragment metadata', () => {
    expect(safeNotificationLink('/dashboard/roleplays?token=private#section')).toBe('/dashboard/roleplays');
  });
  it.each([null, '', 'https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/admin/../api/auth', '/admin/%2e%2e/api', '/api/auth/signout', '/login', '/dashboard-other', '/dashboard//messages'])('blocks unsafe path %s', path => {
    expect(safeNotificationLink(path)).toBeNull();
  });
});
