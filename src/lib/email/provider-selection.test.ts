import { describe, it, expect, vi } from 'vitest';
import { providerSelectionPaused, validProfileId, canEditProviderPreference, changeProviderPreference } from './provider-selection';

const paused = {
  EMAIL_PROVIDER_VAULT_ENABLED: 'true', OPERATIONAL_EMAIL_ENABLED: 'true',
  OPERATIONAL_EMAIL_DISPATCH_ENABLED: 'false', OPERATIONAL_EMAIL_BATCH_ENABLED: 'false',
  OPERATIONAL_EMAIL_BINDING_ENABLED: 'false', OPERATIONAL_EMAIL_GENERAL_ENABLED: 'false',
  OPERATIONAL_EMAIL_SCHEDULER_ENABLED: 'false',
};
describe('provider selection gates', () => {
  it('requires explicit disabled flags rather than missing or ambiguous settings', () => {
    expect(providerSelectionPaused(paused)).toBe(true);
    for (const [key, value] of Object.entries(paused)) {
      expect(providerSelectionPaused({ ...paused, [key]: undefined })).toBe(false);
      expect(providerSelectionPaused({ ...paused, [key]: value === 'true' ? 'false' : 'true' })).toBe(false);
    }
  });
  it('does not consider an invalid provider source safely paused', () => {
    expect(providerSelectionPaused({ ...paused, EMAIL_PROVIDER_SOURCE: 'vualt' })).toBe(false);
    expect(providerSelectionPaused({ ...paused, EMAIL_PROVIDER_SOURCE: 'environment' })).toBe(true);
    expect(providerSelectionPaused({ ...paused, EMAIL_PROVIDER_SOURCE: 'vault' })).toBe(true);
  });
  it('accepts only a UUID-shaped string', () => {
    expect(validProfileId('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    expect(validProfileId(null)).toBe(false);
    expect(validProfileId('invalid')).toBe(false);
  });
});

const pilot = { ...paused, EMAIL_PROVIDER_SOURCE: 'vault', EMAIL_PROVIDER_ENCRYPTION_KEY: '11'.repeat(32),
  OPERATIONAL_EMAIL_PILOT_RECIPIENT: 'pilot@example.test', OPERATIONAL_EMAIL_DISPATCH_ENABLED: 'true' };
const id = '123e4567-e89b-42d3-a456-426614174000';
describe('pause-aware provider preference', () => {
  it('requires the database pause for vault selection even with environment flags disabled', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ paused: false }]), $executeRaw: vi.fn() };
    expect(await canEditProviderPreference(db, pilot)).toBe(false);
    expect(await changeProviderPreference(db, id, 'fixture', pilot)).toBe('disabled');
    expect(await changeProviderPreference(db, id, 'fixture', { ...paused, EMAIL_PROVIDER_SOURCE: 'vault' })).toBe('disabled');
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalledTimes(3);
  });
  it('rejects preference changes for an invalid source without querying the database', async () => {
    const db = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
    const invalid = { ...paused, EMAIL_PROVIDER_SOURCE: 'vualt' };
    expect(await canEditProviderPreference(db, invalid)).toBe(false);
    expect(await changeProviderPreference(db, id, 'fixture', invalid)).toBe('disabled');
    expect(await changeProviderPreference(db, null, 'fixture', invalid)).toBe('disabled');
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('switches only under the selection lock without changing the pause', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ paused: true }]).mockResolvedValueOnce([{ id }]), $executeRaw: vi.fn() };
    expect(await changeProviderPreference(db, id, 'fixture', pilot)).toBe('saved');
    expect(db.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    expect(db.$queryRaw.mock.calls[1][0].join('?')).not.toContain('dispatch_paused');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects a general-mode preference change and a stale unpaused clear', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ paused: false }]), $executeRaw: vi.fn() };
    expect(await changeProviderPreference(db, id, 'fixture', { ...pilot, OPERATIONAL_EMAIL_GENERAL_ENABLED: 'true' })).toBe('disabled');
    expect(await changeProviderPreference(db, null, 'fixture', pilot)).toBe('disabled');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});
