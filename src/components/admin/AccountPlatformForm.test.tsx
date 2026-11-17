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
  it.each([
    'javascript:alert(1)',
    'http://portal.example.test/login',
    'https://user:password@portal.example.test/login',
    'https://portal.example.test/lo\tgin',
    'https://portal.example.test/?access_token=private',
    '',
  ])('never reveals an unsafe stored portal URL: %s', url => {
    render(<WhoerAccessGate url={url} expectedCountry="United States" />);
    expect(screen.getByRole('link', { name: /Whoer.net/i })).toBeTruthy();
    expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/no cumple los requisitos HTTPS/i);
    expect(screen.queryByRole('link', { name: /Abrir portal/i })).toBeNull();
  });

  it('requires new Whoer consent when the portal or expected country changes', () => {
    const { rerender } = render(<WhoerAccessGate url="https://first.example.test/login" expectedCountry="United States" />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('link', { name: /Abrir portal/i }).getAttribute('href')).toBe('https://first.example.test/login');

    rerender(<WhoerAccessGate url="https://second.example.test/login" expectedCountry="United States" />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('link', { name: /Abrir portal/i })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('link', { name: /Abrir portal/i }).getAttribute('href')).toBe('https://second.example.test/login');

    rerender(<WhoerAccessGate url="https://second.example.test/login" expectedCountry="Canada" />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('link', { name: /Abrir portal/i })).toBeNull();
  });

  it('normalizes a safe saved portal URL without exposing it before consent', () => {
    render(<WhoerAccessGate url="  https://portal.example.test/login  " />);
    expect(screen.queryByRole('link', { name: /Abrir portal/i })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('link', { name: /Abrir portal/i }).getAttribute('href')).toBe('https://portal.example.test/login');
  });

});
