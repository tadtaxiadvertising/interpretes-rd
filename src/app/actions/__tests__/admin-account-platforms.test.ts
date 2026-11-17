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

  it('requires an administrator', async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue({ role: 'interpreter' } as never);

    const result = await createAccountPlatform(makeForm({ accountId: '12', name: 'Portal' }));

    expect(result.success).toBe(false);
    expect(prisma.accountPlatform.create).not.toHaveBeenCalled();
  });
});
