// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateProfile, sealProfileCredentials, openProfileCredentials, profileSmtpConfig } from './provider-vault';
import { validateBudget } from './provider-budget';
import { providerCatalog } from './provider-catalog';
const id = '123e4567-e89b-42d3-a456-426614174000';
const key = '11'.repeat(32);
describe('five-provider expansion', () => {
  for (const provider of ['mailjet','smtp2go','mailersend'] as const) {
    it('validates and encrypts both credentials for ' + provider, () => {
      const input = { provider, name: 'Fixture', from: 'office@example.test', replyTo: '', apiKey: 'fixture-user', secretKey: 'fixture-secret' };
      expect(validateProfile({ ...input, secretKey: '' })).toBeNull();
      expect(validateProfile({ ...input, apiKey: 'user:bad' })).toBeNull();
      const profile = validateProfile(input);
      expect(profile).toEqual(input);
      if (!profile) throw new Error('Invalid fixture');
      const sealed = sealProfileCredentials(id, profile, key);
      expect(sealed).not.toContain(input.apiKey);
      expect(sealed).not.toContain(input.secretKey);
      expect(openProfileCredentials(id, provider, sealed, key)).toEqual({ apiKey: input.apiKey, secretKey: input.secretKey });
      expect(openProfileCredentials(id, 'brevo', sealed, key)).toBeNull();
      expect(profileSmtpConfig(profile)).toMatchObject({ host: providerCatalog[provider].host, port: 587, requireTLS: true, secure: false, user: input.apiKey, password: input.secretKey });
      expect(validateBudget({ provider, dailyLimit: providerCatalog[provider].daily + 1, monthlyLimit: 1 })).toBeNull();
      expect(validateBudget({ provider, dailyLimit: 1, monthlyLimit: providerCatalog[provider].monthly + 1 })).toBeNull();
    });
  }
  it('preserves existing API ciphertext compatibility', () => {
    const profile = { provider: 'resend' as const, name: 'Fixture', from: 'office@example.test', replyTo: '', apiKey: 're_fixture-key-123' };
    expect(openProfileCredentials(id, 'resend', sealProfileCredentials(id, profile, key), key)).toEqual({ apiKey: profile.apiKey });
  });
});
