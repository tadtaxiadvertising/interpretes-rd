// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ markNotificationAsRead: vi.fn(), getMyNotifications: vi.fn(), markAllNotificationsAsRead: vi.fn() }));
vi.mock('@/app/actions/notifications', () => m);

import { NotificationBell } from './NotificationBell';

const notifications = [
  { id: 'n1', title: 'Auditoría QA', message: 'Evaluación lista', type: 'info', isRead: false, createdAt: new Date('2026-11-17T12:00:00Z') },
  { id: 'n2', title: 'Turno nuevo', message: 'Nuevo turno', type: 'success', isRead: false, createdAt: new Date('2026-11-17T13:00:00Z') },
];

afterEach(() => cleanup());

describe('NotificationBell interactions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    m.getMyNotifications.mockResolvedValue({ success: false });
    m.markAllNotificationsAsRead.mockResolvedValue({ success: true });
    m.markNotificationAsRead.mockResolvedValue({ success: true });
  });

  it('opens the panel and provides a functional close button, not an inert activity link', () => {
    render(<NotificationBell initialNotifications={notifications} />);
    const bell = screen.getByRole('button', { name: 'Notificaciones' });
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(bell);
    expect(bell.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: 'Notificaciones recientes' })).toBeTruthy();
    expect(screen.getByText('2 sin leer')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View All Activity' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar', exact: true }));
    expect(screen.queryByRole('region', { name: 'Notificaciones recientes' })).toBeNull();
  });

  it('updates the badge after a successful action and does not remove other unread items', async () => {
    render(<NotificationBell initialNotifications={notifications} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída: Auditoría QA' }));
    await waitFor(() => {
      expect(screen.getByText('1 sin leer')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Marcar como leída: Auditoría QA' })).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Marcar como leída: Turno nuevo' })).toBeTruthy();
    expect(m.markNotificationAsRead).toHaveBeenCalledOnce();
    expect(m.markNotificationAsRead).toHaveBeenCalledWith('n1');
  });

  it('shows newly supplied server notifications without losing locally confirmed reads', async () => {
    const { rerender } = render(<NotificationBell initialNotifications={notifications} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída: Auditoría QA' }));
    await waitFor(() => expect(screen.getByText('1 sin leer')).toBeTruthy());

    const newItem = {
      id: 'n3', title: 'Aviso nuevo', message: 'Nueva asignación',
      type: 'warning', isRead: false,
      createdAt: new Date('2026-11-17T14:00:00Z'),
    };
    rerender(<NotificationBell initialNotifications={[...notifications, newItem]} />);
    expect(screen.getByText('2 sin leer')).toBeTruthy();
    expect(screen.getByText('Aviso nuevo')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Marcar como leída: Auditoría QA' })).toBeNull();
  });

  it('prevents duplicate mark-read requests while a request is pending', async () => {
    let finish!: (value: { success: boolean }) => void;
    m.markNotificationAsRead.mockReturnValueOnce(
      new Promise(resolve => { finish = resolve; }),
    );
    render(<NotificationBell initialNotifications={notifications} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    const mark = screen.getByRole('button', { name: 'Marcar como leída: Auditoría QA' });
    fireEvent.click(mark);
    fireEvent.click(mark);
    expect(m.markNotificationAsRead).toHaveBeenCalledTimes(1);
    expect((mark as HTMLButtonElement).disabled).toBe(true);
    finish({ success: true });
    await waitFor(() => expect(screen.getByText('1 sin leer')).toBeTruthy());
  });

  it('handles out-of-order completions without undoing another notification', async () => {
    const resolvers: Array<(value: { success: boolean }) => void> = [];
    m.markNotificationAsRead.mockImplementation(
      () => new Promise(resolve => { resolvers.push(resolve); }),
    );
    render(<NotificationBell initialNotifications={notifications} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída: Auditoría QA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída: Turno nuevo' }));
    resolvers[1]({ success: true });
    await waitFor(() => expect(screen.getByText('1 sin leer')).toBeTruthy());
    resolvers[0]({ success: true });
    await waitFor(() => expect(screen.getByText('0 sin leer')).toBeTruthy());
  });

  it('displays a generic error for a failed action response, leaving the item retryable', async () => {
    m.markNotificationAsRead.mockResolvedValueOnce({
      success: false, error: 'PRIVATE_PASSWORD',
    }).mockResolvedValueOnce({ success: true });
    render(<NotificationBell initialNotifications={notifications} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída: Auditoría QA' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Inténtalo de nuevo'));
    expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE_PASSWORD');
    expect(screen.getByText('2 sin leer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída: Auditoría QA' }));
    await waitFor(() => expect(screen.getByText('1 sin leer')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('handles a rejected server action without leaking provider messages', async () => {
    m.markNotificationAsRead.mockRejectedValueOnce(new Error('postgresql://PRIVATE_PASSWORD'));
    render(<NotificationBell initialNotifications={notifications} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída: Auditoría QA' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE_PASSWORD');
    expect(screen.getByText('2 sin leer')).toBeTruthy();
  });

  it('does not invent a timestamp for legacy notifications with a missing or invalid date', () => {
    render(<NotificationBell initialNotifications={[
      { ...notifications[0], type: null, isRead: null, createdAt: null },
      { ...notifications[1], createdAt: 'invalid-date' },
    ]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    expect(screen.getAllByText('Fecha no disponible')).toHaveLength(2);
    expect(screen.getByText('2 sin leer')).toBeTruthy();
  });

  it('renders an empty notification state with a usable close control', () => {
    render(<NotificationBell initialNotifications={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    expect(screen.getByText('No hay notificaciones.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar', exact: true }));
    expect(screen.queryByText('No hay notificaciones.')).toBeNull();
    expect(m.markNotificationAsRead).not.toHaveBeenCalled();
  });
  it('uses the server unread total beyond the recent list', async () => {
    m.getMyNotifications.mockResolvedValue({ success: true, data: notifications, unreadCount: 24 });
    render(<NotificationBell initialNotifications={notifications} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    await waitFor(() => expect(screen.getByText('24 sin leer')).toBeTruthy());
  });

  it('filters unread items and marks all through one authorized action', async () => {
    m.getMyNotifications.mockResolvedValue({ success: true, data: notifications, unreadCount: 24 });
    m.markAllNotificationsAsRead.mockImplementation(async () => {
      m.getMyNotifications.mockResolvedValue({ success: true, data: notifications.map(n => ({ ...n, isRead: true })), unreadCount: 0 });
      return { success: true };
    });
    render(<NotificationBell initialNotifications={notifications} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    await waitFor(() => expect(screen.getByText('24 sin leer')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sin leer', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    await waitFor(() => expect(screen.getByText('0 sin leer')).toBeTruthy());
    expect(screen.getByText('No hay notificaciones recientes sin leer.')).toBeTruthy();
    expect(m.markAllNotificationsAsRead).toHaveBeenCalledTimes(1);
    expect(m.markAllNotificationsAsRead).toHaveBeenCalledWith();
    fireEvent.click(screen.getByRole('button', { name: 'Todas', exact: true }));
    expect(screen.getByText('Auditoría QA')).toBeTruthy();
  });

  it('keeps the last snapshot when refresh fails and supports retry', async () => {
    m.getMyNotifications.mockResolvedValue({ success: true, data: notifications, unreadCount: 24 });
    render(<NotificationBell initialNotifications={notifications} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    await waitFor(() => expect(screen.getByText('24 sin leer')).toBeTruthy());
    m.getMyNotifications.mockResolvedValue({ success: false });
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(screen.getByText(/No se pudo actualizar/)).toBeTruthy());
    expect(screen.getByText('24 sin leer')).toBeTruthy();
    m.getMyNotifications.mockResolvedValue({ success: true, data: notifications, unreadCount: 25 });
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.getByText('25 sin leer')).toBeTruthy());
    expect(screen.queryByText(/No se pudo actualizar/)).toBeNull();
  });
  it('shows category and severity with safe module links in the quick feed', () => {
    render(<NotificationBell initialNotifications={[
      { ...notifications[0], type: 'warning', category: 'qa', link: '/dashboard?token=private' },
      { ...notifications[1], category: 'private-category', link: '//evil.invalid' },
    ]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    expect(screen.getByText('Calidad (QA)')).toBeTruthy();
    expect(screen.getByText('Atención')).toBeTruthy();
    expect(screen.getByText('Sistema')).toBeTruthy();
    expect(screen.queryByText('private-category')).toBeNull();
    expect(screen.getByRole('link', { name: 'Ir al módulo: Auditoría QA' }).getAttribute('href')).toBe('/dashboard');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
  it('saves a default unread view for this browser and account without altering the total', async () => {
    const items = [notifications[0], { ...notifications[1], isRead: true }];
    const { unmount } = render(<NotificationBell initialNotifications={items} preferenceScope="account-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preferencias de visualización' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Abrir en «Sin leer»' }));
    expect(screen.queryByText('Turno nuevo')).toBeNull();
    expect(screen.getByText('1 sin leer')).toBeTruthy();
    expect(m.markNotificationAsRead).not.toHaveBeenCalled();
    expect(m.markAllNotificationsAsRead).not.toHaveBeenCalled();
    unmount();
    const second = render(<NotificationBell initialNotifications={items} preferenceScope="account-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    expect(screen.queryByText('Turno nuevo')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Todas', exact: true }));
    expect(screen.getByText('Turno nuevo')).toBeTruthy();
    second.unmount();
    render(<NotificationBell initialNotifications={items} preferenceScope="account-b" />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    expect(screen.getByText('Turno nuevo')).toBeTruthy();
  });

  it('prioritizes important recent notices without hiding others and can reset', () => {
    const items = [notifications[0], { ...notifications[1], type: 'error' }];
    render(<NotificationBell initialNotifications={items} preferenceScope="account-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preferencias de visualización' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Priorizar importantes en avisos recientes' }));
    expect(screen.getByText('Turno nuevo').compareDocumentPosition(screen.getByText('Auditoría QA')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('2 sin leer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer preferencias' }));
    expect(screen.getByText('Auditoría QA').compareDocumentPosition(screen.getByText('Turno nuevo')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps preferences functional when browser storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      render(<NotificationBell initialNotifications={notifications} preferenceScope="account-a" />);
      fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
      fireEvent.click(screen.getByRole('button', { name: 'Preferencias de visualización' }));
      const checkbox = screen.getByRole('checkbox', { name: 'Abrir en «Sin leer»' }) as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
      expect(screen.getByText(/Preferencias temporales/)).toBeTruthy();
    } finally { spy.mockRestore(); }
  });
  it('moves keyboard focus into the panel and restores it on Escape and outside dismissal', () => {
    render(<NotificationBell initialNotifications={notifications} />);
    const trigger = screen.getByRole('button', { name: 'Notificaciones' });
    fireEvent.click(trigger);
    const panel = screen.getByRole('region', { name: 'Notificaciones recientes' });
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('region', { name: 'Notificaciones recientes' })).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar notificaciones' }));
    expect(document.activeElement).toBe(trigger);
  });

  it('uses distinct accessible panel IDs and explicit read states', () => {
    render(<><NotificationBell initialNotifications={[notifications[0], { ...notifications[1], isRead: true }]} /><NotificationBell initialNotifications={[]} /></>);
    const triggers = screen.getAllByRole('button', { name: 'Notificaciones' });
    fireEvent.click(triggers[0]);
    expect(screen.getByText('Leída')).toBeTruthy();
    fireEvent.click(triggers[1]);
    expect(triggers[0].getAttribute('aria-controls')).not.toBe(triggers[1].getAttribute('aria-controls'));
  });
  it('shows the full initial unread total before the first refresh completes', () => {
    m.getMyNotifications.mockReturnValue(new Promise(() => {}));
    render(<NotificationBell initialNotifications={notifications} initialUnreadCount={42} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    expect(screen.getByText('42 sin leer')).toBeTruthy();
    expect(m.getMyNotifications).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an unavailable initial total from zero', () => {
    m.getMyNotifications.mockReturnValue(new Promise(() => {}));
    render(<NotificationBell initialNotifications={[]} initialUnreadCount={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    expect(screen.getByText('Total sin comprobar')).toBeTruthy();
  });

  it('does not overlap refreshes across opening, closing, focus and a new layout snapshot', async () => {
    let finish!: (value: unknown) => void;
    m.getMyNotifications.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(<NotificationBell initialNotifications={notifications} />);
    const trigger = screen.getByRole('button', { name: 'Notificaciones' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar', exact: true }));
    fireEvent(window, new Event('focus'));
    rerender(<NotificationBell initialNotifications={[...notifications]} />);
    expect(m.getMyNotifications).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ success: true, data: [], unreadCount: 0 }); });
    await waitFor(() => expect(m.getMyNotifications).toHaveBeenCalledTimes(2));
  });
  it('publishes a scoped invalidation only after a successful read or bulk write', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    try {
      m.markNotificationAsRead.mockResolvedValueOnce({ success: false });
      render(<NotificationBell initialNotifications={notifications} preferenceScope="account-admin" />);
      fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
      fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída: Auditoría QA' }));
      await screen.findByRole('alert');
      expect(spy).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída: Auditoría QA' }));
      await waitFor(() => expect(spy).toHaveBeenCalledExactlyOnceWith('notification-refresh:account-admin', 'changed:v1'));
      fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    } finally { spy.mockRestore(); }
  });

  it('refreshes authoritative data after a sibling-tab signal without repeating a write', async () => {
    render(<NotificationBell initialNotifications={notifications} preferenceScope="account-admin" />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    await screen.findByText(/No se pudo actualizar/);
    m.getMyNotifications.mockResolvedValue({ success: true, data: notifications.map(n => ({ ...n, isRead: true })), unreadCount: 0 });
    fireEvent(window, new StorageEvent('storage', {
      key: 'notification-refresh:account-admin', newValue: 'changed:v1', storageArea: window.localStorage,
    }));
    await waitFor(() => expect(screen.getByText('0 sin leer')).toBeTruthy(), { timeout: 2000 });
    expect(m.markNotificationAsRead).not.toHaveBeenCalled();
    expect(m.markAllNotificationsAsRead).not.toHaveBeenCalled();
  });
});
