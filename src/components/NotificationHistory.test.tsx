// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NotificationHistory } from './NotificationHistory';

const m = vi.hoisted(() => ({ getMyNotificationHistory: vi.fn() }));
vi.mock('@/app/actions/notifications', () => m);

const item = { id: 'old-1', title: 'Aviso anterior', message: 'Evaluación disponible', type: 'info', isRead: false, createdAt: null, link: '/dashboard/roleplays' };
const onRead = vi.fn(async () => {});
const onNavigate = vi.fn();
const props = { onlyUnread: false, refreshVersion: 0, locallyReadIds: [], pendingIds: [], bulkPending: false, onRead, onNavigate };

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

describe('notification history', () => {
  it('loads one page at a time and exposes only its safe module destination', async () => {
    m.getMyNotificationHistory.mockResolvedValueOnce({ success: true, data: [item], hasMore: true })
      .mockResolvedValueOnce({ success: true, data: [{ ...item, id: 'old-2', title: 'Otro aviso', link: null }], hasMore: false });
    render(<NotificationHistory {...props} />);
    const link = await screen.findByRole('link', { name: 'Ir al módulo: Aviso anterior' });
    expect(link.getAttribute('href')).toBe('/dashboard/roleplays');
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída: Aviso anterior' }));
    expect(onRead).toHaveBeenCalledWith('old-1');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('Otro aviso');
    expect(m.getMyNotificationHistory).toHaveBeenLastCalledWith({ page: 1, unreadOnly: false });
    expect((screen.getByRole('button', { name: 'Siguiente' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('requests unread records from the server and retries failed history without leaking errors', async () => {
    m.getMyNotificationHistory.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'))
      .mockResolvedValueOnce({ success: true, data: [item], hasMore: false });
    render(<NotificationHistory {...props} onlyUnread />);
    await screen.findByRole('alert');
    expect(screen.queryByText('PRIVATE_PASSWORD')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar historial' }));
    await waitFor(() => expect(screen.getByText('Aviso anterior')).toBeTruthy());
    expect(m.getMyNotificationHistory).toHaveBeenLastCalledWith({ page: 0, unreadOnly: true });
  });
});
