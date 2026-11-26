import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ usesVault: vi.fn(), resolveEnv: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/email/preferred-provider-runtime', () => ({
  usesProviderVault: m.usesVault, resolveOperationalMailEnv: m.resolveEnv,
}));
vi.mock('./SystemReadinessCheck', () => ({ default: () => <div data-testid="system-check" /> }));
vi.mock('./NotificationDiagnostics', () => ({ default: () => <div data-testid="notification-diagnostics" /> }));
vi.mock('./NotificationEmailBudget', () => ({ default: () => <div data-testid="email-budget" /> }));
vi.mock('./EmailProviderSetup', () => ({ default: () => <div data-testid="provider-setup" /> }));
vi.mock('./EmailProviderReadiness', () => ({ default: () => <div data-testid="provider-readiness" /> }));
vi.mock('./EmailVaultPause', () => ({ default: () => <div data-testid="vault-pause" /> }));
vi.mock('./EmailProviderVault', () => ({ default: () => <div data-testid="provider-vault" /> }));
vi.mock('./CorporateSmtpTest', () => ({ default: () => <div data-testid="smtp-test" /> }));
vi.mock('./RecruitmentEmailPreview', () => ({ default: () => <div data-testid="email-preview" /> }));
vi.mock('./CorporateEmailHistory', () => ({ default: () => <div data-testid="email-history" /> }));
vi.mock('./CorporateEmailPilot', () => ({ default: () => <div data-testid="email-pilot" /> }));
vi.mock('./EmailDatabaseReadiness', () => ({ default: () => <div data-testid="email-database" /> }));

import SettingsPage from './page';

beforeEach(() => {
  vi.resetAllMocks();
  m.usesVault.mockReturnValue(false);
  m.resolveEnv.mockResolvedValue({ OPERATIONAL_EMAIL_ENABLED: 'false' });
});
afterEach(cleanup);

describe('settings communications layout', () => {
  it('links all six shortcuts to uniquely named, focusable sections', async () => {
    render(await SettingsPage());
    const navigation = screen.getByRole('navigation', { name: 'Secciones de configuración' });
    const links = within(navigation).getAllByRole('link');
    expect(links).toHaveLength(6);
    const destinations = links.map(link => link.getAttribute('href'));
    expect(new Set(destinations).size).toBe(6);
    for (const href of destinations) {
      expect(href?.startsWith('#settings-')).toBe(true);
      const target = document.getElementById(href!.slice(1));
      expect(target?.tagName).toBe('SECTION');
      expect(target?.getAttribute('tabindex')).toBe('-1');
      expect(document.getElementById(target!.getAttribute('aria-labelledby')!)).not.toBeNull();
    }
  });

  it('keeps all existing controls mounted in the appropriate group', async () => {
    render(await SettingsPage());
    const groups = [
      ['Estado del sistema', ['system-check']],
      ['Notificaciones y presupuesto', ['notification-diagnostics', 'email-budget']],
      ['Proveedores de correo operativo', ['provider-setup', 'provider-readiness', 'vault-pause', 'provider-vault', 'smtp-test']],
      ['Envíos, historial y automatización', ['email-preview', 'email-history', 'email-pilot', 'email-database']],
    ] as const;
    for (const [name, controls] of groups) {
      const region = screen.getByRole('region', { name });
      for (const control of controls) expect(within(region).getAllByTestId(control)).toHaveLength(1);
    }
    const auth = screen.getByRole('region', { name: 'Correo de autenticación (Supabase)' });
    expect(within(auth).getByRole('link', { name: 'Abrir Supabase (nueva pestaña)' }).getAttribute('href')).toBe('https://supabase.com/dashboard');
    expect(within(auth).queryByTestId('smtp-test')).toBeNull();
    expect(screen.getByRole('link', { name: 'Importar datos CSV' }).getAttribute('href')).toBe('/settings/import');
  });

  it('preserves the vault transport guard instead of rendering the environment test', async () => {
    m.usesVault.mockReturnValue(true);
    render(await SettingsPage());
    expect(screen.queryByTestId('smtp-test')).toBeNull();
    expect(screen.getByTestId('provider-vault')).toBeTruthy();
    expect(screen.getByText(/El transporte de entorno no se utiliza en este modo/)).toBeTruthy();
  });
});
