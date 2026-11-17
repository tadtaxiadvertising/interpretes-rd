// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/app/actions/admin-account-platforms', () => ({
  createAccountPlatform: vi.fn().mockResolvedValue({ success: true }),
}));

import AccountPlatformForm from './AccountPlatformForm';
import WhoerAccessGate from './WhoerAccessGate';

afterEach(() => cleanup());

describe('account platform and VPN form: no duplicated controls', () => {
  it('renders one input for each reference to the external secret manager', () => {
    const { container } = render(<AccountPlatformForm accounts={[
      { id: 7, name: 'Test account', client: { name: 'Test client' }, company: null },
    ]} />);
    for (const name of ['secretRef', 'vpnSecretRef', 'vpnExitIp', 'vpnProfile']) {
      expect(container.querySelectorAll(`[name="${name}"]`)).toHaveLength(1);
    }
    expect(screen.getAllByText(/Antes de iniciar sesión en el portal, abre/i)).toHaveLength(1);
    expect(screen.getByText('Configuración VPN')).toBeTruthy();
  });

  it('requires one explicit Whoer confirmation before revealing the portal link', () => {
    const { container } = render(<WhoerAccessGate
      url="https://portal.example.test/login"
      expectedCountry="United States"
    />);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /Abrir portal/i })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    const portal = screen.getByRole('link', { name: /Abrir portal/i });
    expect(portal.getAttribute('href')).toBe('https://portal.example.test/login');
  });
});
