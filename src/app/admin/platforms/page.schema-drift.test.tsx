// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/prisma', () => ({
  default: {
    account: { findMany: vi.fn() },
    accountPlatform: { findMany: vi.fn() },
  },
  getRawPool: vi.fn(() => ({})),
}));
vi.mock('@/lib/account-vpn-schema-readiness', () => ({
  inspectAccountVpnSchema: vi.fn(),
}));
vi.mock('@/components/admin/AccountPlatformForm', () => ({
  default: () => 'Formulario de plataformas habilitado',
}));

import prisma from '@/lib/prisma';
import { inspectAccountVpnSchema } from '@/lib/account-vpn-schema-readiness';
import AccountPlatformsPage from './page';

const platform = {
  id: 5, name: 'Plataforma principal', active: true,
  loginUrl: 'https://portal.example.test/login', secretRef: null,
  account: { name: 'Cuenta de prueba', client: { name: 'Cliente de prueba' }, company: null },
};

describe('admin platform directory during pending VPN migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 7, name: 'Cuenta de prueba', client: { name: 'Cliente de prueba' }, company: null },
    ] as never);
    vi.mocked(prisma.accountPlatform.findMany).mockResolvedValue([platform] as never);
  });

  it.each(['missing', 'partial'] as const)(
    'renders legacy platforms without selecting unavailable VPN columns (%s)',
    async status => {
      vi.mocked(inspectAccountVpnSchema).mockResolvedValue(status);

      const html = renderToStaticMarkup(await AccountPlatformsPage());
      expect(html).toContain('Plataforma principal');
      expect(html).toContain('Configuración VPN temporalmente no disponible');
      expect(html).toContain('Detalles VPN ocultos hasta verificar la migración');
      expect(html).not.toContain('Formulario de plataformas habilitado');

      expect(prisma.accountPlatform.findMany).toHaveBeenCalledTimes(1);
      const args = vi.mocked(prisma.accountPlatform.findMany).mock.calls[0]?.[0];
      expect(args).toHaveProperty('select.id', true);
      expect(args).toHaveProperty('select.secretRef', true);
      expect(args).not.toHaveProperty('include');
      expect(JSON.stringify(args)).not.toMatch(/vpnCountry|vpnProvider|vpnPort/);
    },
  );

  it('renders VPN data and the registration form only after full schema verification', async () => {
    vi.mocked(inspectAccountVpnSchema).mockResolvedValue('complete');
    vi.mocked(prisma.accountPlatform.findMany)
      .mockResolvedValueOnce([platform] as never)
      .mockResolvedValueOnce([{ id: 5, vpnCountry: 'United States', vpnProvider: 'Example VPN' }] as never);

    const html = renderToStaticMarkup(await AccountPlatformsPage());
    expect(html).toContain('Formulario de plataformas habilitado');
    expect(html).toContain('United States');
    expect(html).toContain('Example VPN');
    expect(html).not.toContain('Detalles VPN ocultos');

    expect(prisma.accountPlatform.findMany).toHaveBeenCalledTimes(2);
    expect(vi.mocked(prisma.accountPlatform.findMany).mock.calls[1]?.[0])
      .toHaveProperty('select.vpnCountry', true);
  });

  it('does not disguise database failures as a missing migration', async () => {
    vi.mocked(inspectAccountVpnSchema).mockRejectedValueOnce(new Error('database unavailable'));
    await expect(AccountPlatformsPage()).rejects.toThrow('database unavailable');
    expect(prisma.accountPlatform.findMany).not.toHaveBeenCalled();
  });
});
