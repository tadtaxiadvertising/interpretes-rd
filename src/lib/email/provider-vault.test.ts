// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { openProfileKey, sealProfileKey, validateProfile, vaultKeyAvailable } from './provider-vault';

const key = '11'.repeat(32);
const id = 'd744183c-c0de-4b90-98b1-e2cba3dbe5ab';
const profile = { name: 'Provider fixture', provider: 'resend', from: 'office@example.test', replyTo: '', apiKey: 're_fixture-key-123' };

describe('private email provider profiles', () => {
  it('validates exactly the supported provider and existing sender rules', () => {
    expect(validateProfile(profile)).toEqual(profile);
    expect(validateProfile({ ...profile, provider: 'smtp' })).toBeNull();
    expect(validateProfile({ ...profile, from: 'bad@example.test,other@example.test' })).toBeNull();
    expect(validateProfile({ ...profile, apiKey: 'not-a-key' })).toBeNull();
    expect(validateProfile({ ...profile, provider: 'brevo', apiKey: 'xsmtpsib-fixture-only' })).toBeNull();
    expect(validateProfile({ ...profile, name: 'x'.repeat(81) })).toBeNull();
    expect(validateProfile(null)).toBeNull();
  });
  it('requires a separate 32-byte hex key', () => {
    expect(vaultKeyAvailable(key)).toBe(true);
    expect(vaultKeyAvailable('invalid')).toBe(false);
    expect(vaultKeyAvailable(undefined)).toBe(false);
    expect(() => sealProfileKey(id, 'resend', profile.apiKey, undefined)).toThrow();
  });
  it('uses a fresh nonce for each encryption and never stores plaintext', () => {
    const a = sealProfileKey(id, 'resend', profile.apiKey, key);
    const b = sealProfileKey(id, 'resend', profile.apiKey, key);
    expect(a).not.toBe(b);
    expect(a).not.toContain(profile.apiKey);
    expect(openProfileKey(id, 'resend', a, key)).toBe(profile.apiKey);
  });
  it('fails closed on swaps, tampering, wrong keys and malformed ciphertext', () => {
    const sealed = sealProfileKey(id, 'resend', profile.apiKey, key);
    const changed = sealed.slice(0, -1) + (sealed.endsWith('a') ? 'b' : 'a');
    expect(openProfileKey('other-id', 'resend', sealed, key)).toBeNull();
    expect(openProfileKey(id, 'brevo', sealed, key)).toBeNull();
    expect(openProfileKey(id, 'resend', changed, key)).toBeNull();
    expect(openProfileKey(id, 'resend', sealed, '22'.repeat(32))).toBeNull();
    expect(openProfileKey(id, 'resend', 'v1:broken', key)).toBeNull();
  });
});
