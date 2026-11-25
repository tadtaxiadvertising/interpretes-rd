// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { inspectProviderVault } from './provider-readiness';

const healthy = { installed: true, columnsReady: true, privateAccess: true, runtimeAccess: true, rls: true };
const env = { EMAIL_PROVIDER_VAULT_ENABLED: 'true', EMAIL_PROVIDER_ENCRYPTION_KEY: 'ab'.repeat(32), EMAIL_PROVIDER_SOURCE: 'vault', OPERATIONAL_EMAIL_ENABLED: 'true', OPERATIONAL_EMAIL_DISPATCH_ENABLED: 'false', OPERATIONAL_EMAIL_BATCH_ENABLED: 'false', OPERATIONAL_EMAIL_BINDING_ENABLED: 'false', OPERATIONAL_EMAIL_GENERAL_ENABLED: 'false', OPERATIONAL_EMAIL_SCHEDULER_ENABLED: 'false' };

describe('provider vault readiness', () => {
  it('returns only safe metadata even with a configured key', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([healthy]) };
    const report = await inspectProviderVault(db, env);
    expect(report).toEqual({ database: 'ready', enabled: true, encryption: 'valid_format', source: 'vault', paused: true });
    expect(JSON.stringify(report)).not.toContain(env.EMAIL_PROVIDER_ENCRYPTION_KEY);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('diagnoses a disabled vault without requiring a key', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([healthy]) };
    expect(await inspectProviderVault(db, {})).toEqual({ database: 'ready', enabled: false, encryption: 'missing', source: 'environment', paused: false });
  });
  it('detects missing objects and permission failures', async () => {
    for (const field of ['installed', 'columnsReady', 'privateAccess', 'runtimeAccess', 'rls'] as const) {
      const db = { $queryRaw: vi.fn().mockResolvedValue([{ ...healthy, [field]: false }]) };
      expect((await inspectProviderVault(db, env)).database).toBe(field === 'installed' || field === 'columnsReady' ? 'not_installed' : 'permission_mismatch');
    }
  });
  it('does not expose database error messages or invalid secrets', async () => {
    const db = { $queryRaw: vi.fn().mockRejectedValue(new Error('private fixture')) };
    const report = await inspectProviderVault(db, { EMAIL_PROVIDER_ENCRYPTION_KEY: 'private fixture', EMAIL_PROVIDER_SOURCE: 'bad' });
    expect(report).toMatchObject({ database: 'unavailable', encryption: 'invalid', source: 'invalid' });
    expect(JSON.stringify(report)).not.toContain('private fixture');
  });
});
