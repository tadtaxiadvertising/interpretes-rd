// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/auth', () => ({
  getCurrentProfile: vi.fn().mockResolvedValue({ role: 'admin' }),
}));

vi.mock('@/lib/prisma', () => ({
  default: { accountPlatform: { create: vi.fn() } },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { createAccountPlatform } from '../admin-account-platforms';

function makeForm(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe('createAccountPlatform VPN configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'admin' } as never);
    vi.mocked(prisma.accountPlatform.create).mockResolvedValue({ id: 1 } as never);
  });

  it('persists optional VPN metadata and a secret reference without plaintext passwords', async () => {
    const result = await createAccountPlatform(makeForm({
      accountId: '12',
      name: 'Portal principal',
      loginUrl: 'https://portal.example.test/login',
      usernameHint: 'operator@example.test',
      secretRef: 'vault://org/account/portal',
      vpnProvider: 'Flexible VPN',
      vpnApp: 'VPN Client',
      vpnUsernameHint: 'vpn-user',
      vpnSecretRef: 'vault://org/account/vpn',
      vpnCountry: 'United States',
      vpnRegion: 'Pennsylvania',
      vpnServer: 'us-east.example.test',
      vpnExitIp: '203.0.113.10',
      vpnProfile: 'Profile B',
      vpnProtocol: 'WireGuard',
      vpnPort: '51820',
      notes: 'Use the configured profile.',
    }));

    expect(result).toEqual({ success: true });
    expect(prisma.accountPlatform.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 12,
        name: 'Portal principal',
        secretRef: 'vault://org/account/portal',
        vpnProvider: 'Flexible VPN',
        vpnApp: 'VPN Client',
        vpnUsernameHint: 'vpn-user',
        vpnSecretRef: 'vault://org/account/vpn',
        vpnCountry: 'United States',
        vpnRegion: 'Pennsylvania',
        vpnServer: 'us-east.example.test',
        vpnExitIp: '203.0.113.10',
        vpnProfile: 'Profile B',
        vpnProtocol: 'WireGuard',
        vpnPort: 51820,
      }),
    });
  });

  it('rejects an out-of-range VPN port before writing', async () => {
    const result = await createAccountPlatform(makeForm({
      accountId: '12',
      name: 'Portal principal',
      vpnPort: '70000',
    }));

    expect(result.success).toBe(false);
    expect(prisma.accountPlatform.create).not.toHaveBeenCalled();
  });

  it('rejects malformed exit IP addresses before writing', async () => {
    const result = await createAccountPlatform(makeForm({
      accountId: '12',
      name: 'Portal',
      vpnExitIp: 'not-an-ip-address',
    }));

    expect(result.success).toBe(false);
    expect(prisma.accountPlatform.create).not.toHaveBeenCalled();
  });

  it('rejects a portal URL whose control characters would be stripped by URL parsing', async () => {
    const result = await createAccountPlatform(makeForm({
      accountId: '12',
      name: 'Portal principal',
      loginUrl: 'https://portal.example.test/lo\tgin',
    }));
    expect(result.success).toBe(false);
    expect(prisma.accountPlatform.create).not.toHaveBeenCalled();
  });

  it('does not log secrets or connection strings from provider errors', async () => {
    vi.mocked(prisma.accountPlatform.create).mockRejectedValueOnce(
      new Error('postgresql://service:PRIVATE_CREDENTIAL@database.internal.invalid/db'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await createAccountPlatform(makeForm({
        accountId: '12', name: 'Portal principal', loginUrl: 'https://portal.example.test/login',
      }));
      expect(result.success).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('[PLATFORMS] Create failed:', 'Error');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/PRIVATE_CREDENTIAL|database\.internal\.invalid|postgresql:/);
    } finally {
      spy.mockRestore();
    }
  });

  it('requires an administrator', async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'interpreter' } as never);

    const result = await createAccountPlatform(makeForm({ accountId: '12', name: 'Portal' }));

    expect(result.success).toBe(false);
    expect(prisma.accountPlatform.create).not.toHaveBeenCalled();
  });
  it('does not report an already-committed platform as failed when cache invalidation fails', async () => {
    vi.mocked(revalidatePath).mockImplementationOnce(() => { throw new Error('PRIVATE_CACHE_TOKEN'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await createAccountPlatform(makeForm({
        accountId: '12',
        name: 'Portal principal',
      }));
      expect(result).toEqual({ success: true });
      expect(prisma.accountPlatform.create).toHaveBeenCalledTimes(1);
      expect(revalidatePath).toHaveBeenNthCalledWith(1, '/admin/platforms');
      expect(revalidatePath).toHaveBeenNthCalledWith(2, '/admin/accounts');
      expect(warn).toHaveBeenCalledWith('[PLATFORMS] Saved but cache refresh failed:', 'Error');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_CACHE_TOKEN');
    } finally { warn.mockRestore(); }
  });

  it('redacts provider credentials when creating a platform fails before commit', async () => {
    vi.mocked(prisma.accountPlatform.create).mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_PASSWORD@db.internal/platforms'),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await createAccountPlatform(makeForm({
        accountId: '12', name: 'Portal principal',
      }));
      expect(result.success).toBe(false);
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith('[PLATFORMS] Create failed:', 'Error');
      expect(JSON.stringify([result, spy.mock.calls])).not.toMatch(/PRIVATE_PASSWORD|db\\.internal|postgresql:/);
    } finally { spy.mockRestore(); }
  });

});
