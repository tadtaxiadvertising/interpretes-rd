import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/auth', () => ({ logout: vi.fn() }));
vi.mock('./NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('./ThemeSwitcher', () => ({ ThemeSwitcher: () => null }));
vi.mock('next/image', () => ({ default: () => null }));

import { Navbar } from './Navbar';

afterEach(() => cleanup());

describe('Navbar account menu', () => {
  it('routes administrators to the correct system configuration page', () => {
    render(<Navbar email="Administración" role="admin" />);
    const menu = screen.getByRole('button', { name: 'Menú de usuario' });
    fireEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Configuración' }).getAttribute('href')).toBe('/settings');
    expect(screen.getByText('Administrador')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy();
  });

  it('preserves interpreter settings and closes the menu with Escape', () => {
    render(<Navbar email="Intérprete" role="interpreter" />);
    fireEvent.click(screen.getByRole('button', { name: 'Menú de usuario' }));
    expect(screen.getByRole('link', { name: 'Configuración' }).getAttribute('href')).toBe('/dashboard/settings');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'Configuración' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Menú de usuario' }).getAttribute('aria-expanded')).toBe('false');
  });
});
