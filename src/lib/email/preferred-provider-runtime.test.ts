// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readPreferredProvider, resolveOperationalMailEnv, runtimeMailConfigured, reserveSelectedProvider } from './preferred-provider-runtime';
import { sealProfileKey } from './provider-vault';

const key = '11'.repeat(32);
const id = '123e4567-e89b-42d3-a456-426614174000';
const apiKey = 're_fixture-key-123';
const env = {
  EMAIL_PROVIDER_SOURCE: 'vault', EMAIL_PROVIDER_VAULT_ENABLED: 'true',
  EMAIL_PROVIDER_ENCRYPTION_KEY: key, OPERATIONAL_EMAIL_ENABLED: 'true',
  OPERATIONAL_EMAIL_DISPATCH_ENABLED: 'true', OPERATIONAL_EMAIL_PILOT_RECIPIENT: 'pilot@example.test',
  OPERATIONAL_EMAIL_GENERAL_ENABLED: 'false', OPERATIONAL_EMAIL_PROVIDER: 'brevo',
  BREVO_API_KEY: 'fixture-legacy-key', OPERATIONAL_EMAIL_FROM: 'old@example.test',
};
const row = { id, name: 'Fixture', provider: 'resend' as const, from: 'office@example.test', replyTo: '', sealed: sealProfileKey(id, 'resend', apiKey, key) };
const db = (rows: unknown[]) => ({ $queryRaw: vi.fn().mockResolvedValue(rows) });

describe('preferred provider runtime', () => {
  it('uses the selected API credential and sender, never the old environment key', async () => {
    expect(await readPreferredProvider(db([row]), env)).toMatchObject({ id, apiKey, from: row.from });
    expect(await resolveOperationalMailEnv(db([row]), env)).toMatchObject({
      OPERATIONAL_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: apiKey, BREVO_API_KEY: undefined, OPERATIONAL_EMAIL_FROM: row.from,
    });
  });
  it('fails closed on absent profile, unavailable budget or decryption failure', async () => {
    expect(await runtimeMailConfigured(db([]), env)).toBe(false);
    expect(await readPreferredProvider(db([row]), { ...env, EMAIL_PROVIDER_ENCRYPTION_KEY: '22'.repeat(32) })).toBeNull();
    expect(await resolveOperationalMailEnv(db([]), env)).toMatchObject({ OPERATIONAL_EMAIL_PROVIDER: 'vault_unavailable' });
  });
  it('does not permit general delivery in vault mode', async () => {
    const general = { ...env, OPERATIONAL_EMAIL_PILOT_RECIPIENT: '', OPERATIONAL_EMAIL_GENERAL_ENABLED: 'true' };
    expect(await runtimeMailConfigured(db([row]), general)).toBe(false);
    expect(await resolveOperationalMailEnv(db([row]), general)).toMatchObject({ OPERATIONAL_EMAIL_PROVIDER: 'vault_unavailable' });
  });
  it('rejects an invalid source without reading the vault or using environment credentials', async () => {
    const reader = db([row]);
    const invalid = { ...env, EMAIL_PROVIDER_SOURCE: 'vualt', OPERATIONAL_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: apiKey };
    expect(await runtimeMailConfigured(reader, invalid)).toBe(false);
    expect(await resolveOperationalMailEnv(reader, invalid)).toMatchObject({ OPERATIONAL_EMAIL_PROVIDER: 'invalid_source' });
    expect(reader.$queryRaw).not.toHaveBeenCalled();
    expect(await runtimeMailConfigured(reader, { ...invalid, EMAIL_PROVIDER_SOURCE: 'environment' })).toBe(true);
  });
  it('never reserves after the selected profile changes', async () => {
    const reader = db([]);
    expect(await reserveSelectedProvider(reader, { ...row, apiKey })).toBe(false);
    expect(reader.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
