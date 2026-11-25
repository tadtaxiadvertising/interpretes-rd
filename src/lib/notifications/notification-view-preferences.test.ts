import { describe, expect, it } from 'vitest';
import { parseNotificationViewPreferences, notificationImportance } from './notification-view-preferences';
import { notificationPreferenceScope } from './notification-preference-scope';

describe('notification view preferences', () => {
  it.each([null, '', 'invalid', 'null', '[]', '{"openUnread":"true","prioritizeImportant":1}'])('uses safe defaults for %s', raw => {
    expect(parseNotificationViewPreferences(raw)).toEqual({ openUnread: false, prioritizeImportant: false });
  });
  it('accepts only explicit boolean options', () => {
    expect(parseNotificationViewPreferences('{"openUnread":true,"prioritizeImportant":true,"extra":"ignored"}')).toEqual({ openUnread: true, prioritizeImportant: true });
  });
  it('ranks errors before warnings and keeps normal notices', () => {
    expect(['error', 'warning', 'success', 'info', null].map(notificationImportance)).toEqual([2, 1, 0, 0, 0]);
  });
  it('isolates accounts and roles without serializing their identity', () => {
    const scope = notificationPreferenceScope('account-1', 'candidate');
    expect(scope).toMatch(/^[a-f0-9]{64}$/);
    expect(scope).toBe(notificationPreferenceScope('account-1', 'candidate'));
    expect(scope).not.toBe(notificationPreferenceScope('account-2', 'candidate'));
    expect(scope).not.toBe(notificationPreferenceScope('account-1', 'interpreter'));
    expect(notificationPreferenceScope(null, 'candidate')).toBeUndefined();
  });
});
