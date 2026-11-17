// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ markNotificationAsRead: vi.fn() }));
vi.mock('@/app/actions/notifications', () => ({ markNotificationAsRead: m.markNotificationAsRead }));

import { NotificationBell } from './NotificationBell';

const notifications = [
  { id: 'n1', title: 'Auditoría QA', message: 'Evaluación lista', type: 'info', isRead: false, createdAt: new Date('2026-11-17T12:00:00Z') },
  { id: 'n2', title: 'Turno nuevo', message: 'Nuevo turno', type: 'success', isRead: false, createdAt: new Date('2026-11-17T13:00:00Z') },
];

afterEach(() => cleanup());

describe('NotificationBell interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
