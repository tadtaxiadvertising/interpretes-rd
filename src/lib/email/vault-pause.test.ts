// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readVaultPause, setVaultPause, canUnpauseVault } from './vault-pause';
const env = { EMAIL_PROVIDER_SOURCE:'vault', EMAIL_PROVIDER_VAULT_ENABLED:'true', OPERATIONAL_EMAIL_ENABLED:'true', EMAIL_PROVIDER_ENCRYPTION_KEY:'ab'.repeat(32), OPERATIONAL_EMAIL_PILOT_RECIPIENT:'pilot@example.test', OPERATIONAL_EMAIL_GENERAL_ENABLED:'false', OPERATIONAL_EMAIL_SCHEDULER_ENABLED:'false' };
describe('vault emergency pause', () => {
  it('requires explicit pilot mode and no scheduler to resume', () => {
    expect(canUnpauseVault(env)).toBe(true);
    expect(canUnpauseVault({...env, OPERATIONAL_EMAIL_GENERAL_ENABLED:'true'})).toBe(false);
    expect(canUnpauseVault({...env, OPERATIONAL_EMAIL_SCHEDULER_ENABLED:'true'})).toBe(false);
    expect(canUnpauseVault({...env, EMAIL_PROVIDER_SOURCE:'environment'})).toBe(false);
    expect(canUnpauseVault({...env, EMAIL_PROVIDER_ENCRYPTION_KEY:'bad'})).toBe(false);
  });
  it('reports missing or unreadable state as unavailable', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('fixture')).mockResolvedValueOnce([{paused:true}]).mockResolvedValueOnce([{paused:false}]) };
    expect(await readVaultPause(db)).toBe('unavailable');
    expect(await readVaultPause(db)).toBe('unavailable');
    expect(await readVaultPause(db)).toBe('paused');
    expect(await readVaultPause(db)).toBe('unpaused');
  });
  it('requires exactly one confirmed change and a valid actor', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{paused:true}]) };
    expect(await setVaultPause(db,true,'')).toBe(false);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(await setVaultPause(db,false,'fixture')).toBe(false);
    expect(await setVaultPause(db,true,'fixture')).toBe(true);
  });
});
