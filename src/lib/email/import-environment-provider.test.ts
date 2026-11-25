// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { existingEnvironmentProfile, importEnvironmentProvider } from './import-environment-provider';
import { openProfileCredentials } from './provider-vault';

const env = {
  EMAIL_PROVIDER_VAULT_ENABLED: 'true', EMAIL_PROVIDER_ENCRYPTION_KEY: 'ab'.repeat(32),
  OPERATIONAL_EMAIL_ENABLED: 'true', OPERATIONAL_EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'fixture-brevo-key-only',
  OPERATIONAL_EMAIL_FROM: 'office@example.test', OPERATIONAL_EMAIL_REPLY_TO: '',
  OPERATIONAL_EMAIL_DISPATCH_ENABLED: 'false', OPERATIONAL_EMAIL_BATCH_ENABLED: 'false',
  OPERATIONAL_EMAIL_BINDING_ENABLED: 'false', OPERATIONAL_EMAIL_GENERAL_ENABLED: 'false', OPERATIONAL_EMAIL_SCHEDULER_ENABLED: 'false',
};
describe('existing provider import', () => {
  it('requires explicit environment origin, disabled dispatch and a valid key', () => {
    expect(existingEnvironmentProfile(env)).toMatchObject({ provider: 'brevo', from: env.OPERATIONAL_EMAIL_FROM });
    expect(existingEnvironmentProfile({ ...env, EMAIL_PROVIDER_SOURCE: 'vault' })).toBeNull();
    expect(existingEnvironmentProfile({ ...env, OPERATIONAL_EMAIL_DISPATCH_ENABLED: 'true' })).toBeNull();
    expect(existingEnvironmentProfile({ ...env, EMAIL_PROVIDER_ENCRYPTION_KEY: 'invalid' })).toBeNull();
    expect(existingEnvironmentProfile({ ...env, OPERATIONAL_EMAIL_PROVIDER: 'smtp' })).toBeNull();
  });
  it('does not overwrite an existing profile or import when pause is absent', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{singleton:true}]).mockResolvedValueOnce([{present:true}]), $executeRaw: vi.fn() };
    expect(await importEnvironmentProvider(db, env, 'fixture')).toBe('blocked');
    expect(await importEnvironmentProvider(db, env, 'fixture')).toBe('already_saved');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('creates a fresh encrypted profile without selecting it or inheriting proof', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{singleton:true}]).mockResolvedValueOnce([{present:false}]), $executeRaw: vi.fn().mockResolvedValue(1) };
    expect(await importEnvironmentProvider(db, env, 'fixture')).toBe('imported');
    const args = db.$executeRaw.mock.calls[0];
    expect(openProfileCredentials(args[1], 'brevo', args[6], env.EMAIL_PROVIDER_ENCRYPTION_KEY)).toEqual({apiKey:env.BREVO_API_KEY});
    expect(JSON.stringify(args)).not.toContain(env.BREVO_API_KEY);
    expect(args[0].join('?')).not.toMatch(/test_accepted_at|receipt_confirmed_at|UPDATE/);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw.mock.calls[0][0].join('?')).toContain('dispatch_paused FOR UPDATE');
  });
});
