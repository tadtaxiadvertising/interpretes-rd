// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { retireProviderProfile, replaceProviderProfile, validateReplacement } from './provider-lifecycle';

const id = '123e4567-e89b-42d3-a456-426614174000';
const profile = { name: 'Fixture', provider: 'brevo' as const, from: 'office@example.test', replyTo: '', apiKey: 'fixture-api-key-only' };
const key = '11'.repeat(32);

describe('provider lifecycle', () => {
  it('requires valid ID and complete replacement credentials', () => {
    expect(validateReplacement({ id, profile })).toEqual({ id, profile });
    expect(validateReplacement({ id: 'bad', profile })).toBeNull();
    expect(validateReplacement({ id, profile: { ...profile, apiKey: '' } })).toBeNull();
  });
  it('does not mutate when the selection row is absent', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn() };
    await expect(retireProviderProfile(db, id, 'fixture')).rejects.toThrow('Selection unavailable');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('does not replace an already retired profile', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ singleton: true }]), $executeRaw: vi.fn().mockResolvedValue(0) };
    expect(await replaceProviderProfile(db, { id, profile }, 'fixture', key)).toBe(false);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it('rejects provider type changes so the transaction can roll back', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ singleton: true }]).mockResolvedValueOnce([{ provider: 'resend' }]), $executeRaw: vi.fn().mockResolvedValue(1) };
    await expect(replaceProviderProfile(db, { id, profile }, 'fixture', key)).rejects.toThrow('Provider type cannot change');
    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
  });
  it('inserts a replacement with a new identity and without plaintext or old proof', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ singleton: true }]).mockResolvedValueOnce([{ provider: 'brevo' }]), $executeRaw: vi.fn().mockResolvedValue(1) };
    expect(await replaceProviderProfile(db, { id, profile }, 'fixture', key)).toBe(true);
    const args = db.$executeRaw.mock.calls[2];
    expect(args[1]).not.toBe(id);
    expect(args.at(-1)).toBe(id);
    expect(JSON.stringify(args)).not.toContain(profile.apiKey);
    expect(String(args[0])).not.toContain('test_accepted_at');
  });
});
