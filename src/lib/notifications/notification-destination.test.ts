import { describe, expect, it } from 'vitest';
import { notificationDestination } from './notification-destination';

describe('notification destinations by current role', () => {
  it.each([
    ['/recruitment', 'admin', 'recruitment'],
    ['/admin/roleplay-audio-jobs', 'admin', 'roleplay'],
    ['/dashboard', 'interpreter', 'qa'],
    ['/dashboard/roleplays', 'interpreter', 'roleplay'],
    ['/candidate', 'candidate', 'recruitment'],
  ])('keeps canonical event destination %s for %s', (path, role, category) => {
    expect(notificationDestination(path, role, category)).toBe(path);
  });

  it.each([
    ['/admin/accounts', 'interpreter', 'operations'],
    ['/dashboard/roleplays', 'admin', 'roleplay'],
    ['/candidate', 'interpreter', 'recruitment'],
    ['/candidate', 'candidate', 'system'],
    ['/admin/messages', 'candidate', 'messaging'],
    ['/dashboard/roleplays/deleted-session', 'interpreter', 'roleplay'],
    ['/admin/not-a-module', 'admin', 'system'],
    ['/roleplays/private-token', 'interpreter', 'roleplay'],
    ['/admin', null, 'system'],
    ['//external.invalid', 'admin', 'system'],
    ['/admin/%2e%2e/api', 'admin', 'system'],
  ])('suppresses inappropriate or unverified destination %s for %s', (path, role, category) => {
    expect(notificationDestination(path, role, category)).toBeNull();
  });

  it('maps old chat entry points to the current role without retaining query or fragment data', () => {
    expect(notificationDestination('/admin/messages?token=private#secret', 'interpreter', 'messaging')).toBe('/dashboard/messages');
    expect(notificationDestination('/dashboard/messages', 'admin', 'messaging')).toBe('/admin/messages');
    expect(notificationDestination('/admin/messages', 'interpreter', 'system')).toBeNull();
  });
});
