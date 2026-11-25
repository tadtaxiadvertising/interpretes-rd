// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { openProfileCredentials } from './provider-vault';
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
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ singleton: true }]).mockResolvedValueOnce([]), $executeRaw: vi.fn() };
    expect(await replaceProviderProfile(db, { id, profile }, 'fixture', key)).toBe(false);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects provider type changes so the transaction can roll back', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ singleton: true }]).mockResolvedValueOnce([{ provider: 'resend' }]), $executeRaw: vi.fn().mockResolvedValue(1) };
    await expect(replaceProviderProfile(db, { id, profile }, 'fixture', key)).rejects.toThrow('Provider type cannot change');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects a conflicting active sender before retiring or clearing preference', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ singleton: true }]).mockResolvedValueOnce([{ provider: 'brevo' }]).mockResolvedValueOnce([{ present: true }]), $executeRaw: vi.fn() };
    expect(await replaceProviderProfile(db, { id, profile }, 'fixture', key)).toBe('already_saved');
    expect(db.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    expect(db.$queryRaw.mock.calls[2][0].join('?')).toContain('AND id <> ?::uuid');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('inserts a replacement with a new identity and without plaintext or old proof', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ singleton: true }]).mockResolvedValueOnce([{ provider: 'brevo' }]).mockResolvedValueOnce([{ present: false }]).mockResolvedValueOnce([{ singleton: true }]), $executeRaw: vi.fn().mockResolvedValue(1) };
    expect(await replaceProviderProfile(db, { id, profile }, 'fixture', key)).toBe(true);
    const args = db.$executeRaw.mock.calls[2];
    expect(args[1]).not.toBe(id);
    expect(args.at(-1)).toBe(id);
    expect(JSON.stringify(args)).not.toContain(profile.apiKey);
    expect(String(args[0])).not.toContain('test_accepted_at');
  });
  it('preserves both encrypted SMTP credentials when replacing a profile', async () => {
    const smtpProfile = { ...profile, provider: 'mailjet' as const, apiKey: 'fixture-user', secretKey: 'fixture-secret' };
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ singleton: true }]).mockResolvedValueOnce([{ provider: 'mailjet' }]).mockResolvedValueOnce([{ present: false }]).mockResolvedValueOnce([{ singleton: true }]), $executeRaw: vi.fn().mockResolvedValue(1) };
    expect(await replaceProviderProfile(db, { id, profile: smtpProfile }, 'fixture', key)).toBe(true);
    const args = db.$executeRaw.mock.calls[2];
    const newId = args[1] as string;
    const sealed = args[6] as string;
    expect(newId).not.toBe(id);
    expect(openProfileCredentials(newId, 'mailjet', sealed, key)).toEqual({ apiKey: smtpProfile.apiKey, secretKey: smtpProfile.secretKey });
    expect(JSON.stringify(args)).not.toContain(smtpProfile.secretKey);
    expect(openProfileCredentials(id, 'mailjet', sealed, key)).toBeNull();
  });
});
