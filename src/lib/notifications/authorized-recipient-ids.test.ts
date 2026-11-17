import { describe, expect, it } from 'vitest';
import { authorizedNotificationRecipientIds } from './authorized-recipient-ids';

const account = '48fb69c9-2ea0-497b-b599-bfd1845ea812';
const profile = '123e4567-e89b-42d3-a456-426614174000';

describe('trusted notification recipient identity normalization', () => {
  it('preserves both validated account and linked profile IDs', () => {
    expect(authorizedNotificationRecipientIds(account, profile)).toEqual([account, profile]);
  });

  it('deduplicates a profile identical to the authenticated account', () => {
    expect(authorizedNotificationRecipientIds(account, account)).toEqual([account]);
    expect(authorizedNotificationRecipientIds(account.toUpperCase(), account)).toEqual([account.toUpperCase()]);
  });

  it('ignores non-UUID RBAC IDs and non-existent profile IDs', () => {
    expect(authorizedNotificationRecipientIds('rbac-1', profile)).toEqual([profile]);
    expect(authorizedNotificationRecipientIds(account, null)).toEqual([account]);
    expect(authorizedNotificationRecipientIds(null, null)).toEqual([]);
  });

  it('rejects malformed or injected UUID-like strings and does not mutate inputs', () => {
    const inputs = ['123e4567-e89b-42d3-a456-426614174000 OR true',
      ' 123e4567-e89b-42d3-a456-426614174000', '', '0000', 'null'];
    for (const value of inputs) {
      expect(authorizedNotificationRecipientIds(value, undefined)).toEqual([]);
    }
  });
});
