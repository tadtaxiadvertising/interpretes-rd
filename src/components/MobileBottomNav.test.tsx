import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePathname } from 'next/navigation';
import { MobileBottomNav } from './MobileBottomNav';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin'),
}));

describe('MobileBottomNav', () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/admin');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps four key admin links visible and provides the rest through Más', () => {
    render(<MobileBottomNav role="admin" />);
    const navigation = screen.getByRole('navigation', { name: 'Navegación administrativa' });
    expect(within(navigation).getByRole('link', { name: 'Centro de control' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Intérpretes' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Reclutamiento' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Roleplays' })).toBeTruthy();
    expect(within(navigation).queryByRole('link', { name: 'Compañías' })).toBeNull();

    fireEvent.click(within(navigation).getByRole('button', { name: 'Mostrar más secciones' }));
    expect(within(navigation).getByRole('link', { name: 'Compañías' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Estudio de audio' })).toBeTruthy();
    expect(within(navigation).getByRole('link', { name: 'Nómina y tarifas' })).toBeTruthy();
  });

  it('keeps nested admin routes selected only within Más', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/roleplays/studio');
    render(<MobileBottomNav role="admin" />);
    const primary = screen.getByRole('link', { name: 'Roleplays' });
    expect(primary.getAttribute('aria-current')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar más secciones' }));
    expect(screen.getByRole('link', { name: 'Estudio de audio' }).getAttribute('aria-current')).toBe('page');
  });

  it('closes all-sections panel with Escape or a selected link', () => {
    render(<MobileBottomNav role="admin" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar más secciones' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Más secciones' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar más secciones' }));
    fireEvent.click(screen.getByRole('link', { name: 'Compañías' }));
    expect(screen.queryByRole('region', { name: 'Más secciones' })).toBeNull();
  });

  it('keeps interpreters remaining tools reachable without horizontal scrolling', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/messages');
    render(<MobileBottomNav role="interpreter" />);
    const navigation = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(navigation).getByRole('link', { name: 'Mi panel' })).toBeTruthy();
    expect(within(navigation).queryByRole('link', { name: 'Mensajería' })).toBeNull();
    fireEvent.click(within(navigation).getByRole('button', { name: 'Mostrar más secciones' }));
    expect(within(navigation).getByRole('link', { name: 'Mensajería' }).getAttribute('aria-current')).toBe('page');
    expect(within(navigation).getByRole('link', { name: 'Configuración' })).toBeTruthy();
  });
});
