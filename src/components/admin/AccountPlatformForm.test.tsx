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
  it('renders each secret reference and VPN field only once', () => {
    const { container } = render(<AccountPlatformForm accounts={[
      { id: 7, name: 'Test account', client: { name: 'Test client' }, company: null },
    ]} />);
    for (const field of ['secretRef', 'vpnSecretRef', 'vpnExitIp', 'vpnProfile']) {
      expect(container.querySelectorAll(`[name="${field}"]`)).toHaveLength(1);
    }
    expect(container.querySelectorAll('a[href="https://whoer.net/"]')).toHaveLength(1);
    expect(screen.getByText('Configuración VPN')).toBeTruthy();
  });

  it('requires one manual Whoer confirmation before revealing the portal link', () => {
    const { container } = render(<WhoerAccessGate
      url="https://portal.example.test/login"
      expectedCountry="United States"
    />);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /Abrir portal/i })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    const link = screen.getByRole('link', { name: /Abrir portal/i });
    expect(link.getAttribute('href')).toBe('https://portal.example.test/login');
  });
});
