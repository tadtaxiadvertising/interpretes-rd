// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createProviderProfile } from './create-provider-profile';

const input = { name: 'Fixture', provider: 'brevo', from: 'Office@example.test', replyTo: '', apiKey: 'fixture-key-123456789' };
const key = 'ab'.repeat(32);
const actor = 'admin-fixture';

describe('manual provider profile creation', () => {
  it('rejects invalid input before querying', async () => {
    const db = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
    expect(await createProviderProfile(db, { ...input, apiKey: '' }, actor, key)).toBe('invalid');
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('locks selection before a case-insensitive duplicate check and never overwrites', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ singleton: true }]).mockResolvedValueOnce([{ present: true }]), $executeRaw: vi.fn() };
    expect(await createProviderProfile(db, input, actor, key)).toBe('already_saved');
    expect(db.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    expect(db.$queryRaw.mock.calls[1][0].join('?')).toContain('lower(sender)=lower(?)');
    expect(db.$queryRaw.mock.calls[1][0].join('?')).toContain('retired_at IS NULL');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('requires a selection row and a successful quota-backed insert', async () => {
    const missing = { $queryRaw: vi.fn().mockResolvedValueOnce([]), $executeRaw: vi.fn() };
    expect(await createProviderProfile(missing, input, actor, key)).toBe('unavailable');
    expect(missing.$executeRaw).not.toHaveBeenCalled();
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ singleton: true }]).mockResolvedValueOnce([{ present: false }]), $executeRaw: vi.fn().mockResolvedValueOnce(0) };
    expect(await createProviderProfile(db, input, actor, key)).toBe('unavailable');
    expect(db.$executeRaw.mock.calls[0][0].join('?')).toContain('WHERE EXISTS (SELECT 1 FROM private_email.provider_quota');
  });
  it('inserts encrypted credentials without activating the profile', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ singleton: true }]).mockResolvedValueOnce([{ present: false }]), $executeRaw: vi.fn().mockResolvedValueOnce(1) };
    expect(await createProviderProfile(db, input, actor, key)).toBe('saved');
    expect(db.$executeRaw.mock.calls[0].slice(1)).not.toContain(input.apiKey);
    expect(db.$executeRaw.mock.calls[0].some(value => typeof value === 'string' && value.startsWith('v1:'))).toBe(true);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
