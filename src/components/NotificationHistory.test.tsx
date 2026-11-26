// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NotificationHistory } from './NotificationHistory';

const m = vi.hoisted(() => ({ getMyNotificationHistory: vi.fn() }));
vi.mock('@/app/actions/notifications', () => m);

const item = { id: 'old-1', title: 'Aviso anterior', message: 'Evaluación disponible', type: 'info', isRead: false, createdAt: null, link: '/dashboard/roleplays' };
const nextCursor = { id: 'old-1', createdAt: null };
const onRead = vi.fn(async () => {});
const onNavigate = vi.fn();
const props = { onlyUnread: false, refreshVersion: 0, locallyReadIds: [], pendingIds: [], bulkPending: false, onRead, onNavigate };

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

describe('notification history', () => {
  it('loads one page at a time and exposes only its safe module destination', async () => {
    m.getMyNotificationHistory.mockResolvedValueOnce({ success: true, data: [item], hasMore: true, nextCursor })
      .mockResolvedValueOnce({ success: true, data: [{ ...item, id: 'old-2', title: 'Otro aviso', link: null }], hasMore: false, nextCursor: null });
    render(<NotificationHistory {...props} />);
    const link = await screen.findByRole('link', { name: 'Ir al módulo: Aviso anterior' });
    expect(link.getAttribute('href')).toBe('/dashboard/roleplays');
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída: Aviso anterior' }));
    expect(onRead).toHaveBeenCalledWith('old-1');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('Otro aviso');
    expect(m.getMyNotificationHistory).toHaveBeenLastCalledWith({ page: 1, after: nextCursor, unreadOnly: false });
    expect((screen.getByRole('button', { name: 'Siguiente' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('requests unread records from the server and retries failed history without leaking errors', async () => {
    m.getMyNotificationHistory.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'))
      .mockResolvedValueOnce({ success: true, data: [item], hasMore: false, nextCursor: null });
    render(<NotificationHistory {...props} onlyUnread />);
    await screen.findByRole('alert');
    expect(screen.queryByText('PRIVATE_PASSWORD')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar historial' }));
    await waitFor(() => expect(screen.getByText('Aviso anterior')).toBeTruthy());
    expect(m.getMyNotificationHistory).toHaveBeenLastCalledWith({ page: 0, after: null, unreadOnly: true });
  });
  it('resets pagination and requests category and severity filters from the server', async () => {
    m.getMyNotificationHistory.mockResolvedValue({ success: true, data: [{ ...item, category: 'roleplay', type: 'warning' }], hasMore: true, nextCursor });
    render(<NotificationHistory {...props} />);
    await screen.findByText('Aviso anterior');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(screen.getByText('Página 2')).toBeTruthy());
    await screen.findByText('Aviso anterior');
    fireEvent.change(screen.getByRole('combobox', { name: 'Categoría' }), { target: { value: 'roleplay' } });
    await waitFor(() => expect(m.getMyNotificationHistory).toHaveBeenLastCalledWith({ page: 0, after: null, unreadOnly: false, category: 'roleplay' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo importantes' }));
    await waitFor(() => expect(m.getMyNotificationHistory).toHaveBeenLastCalledWith({ page: 0, after: null, unreadOnly: false, category: 'roleplay', importantOnly: true }));
    expect(await screen.findByText('Atención')).toBeTruthy();
  });
  it('retains the original boundary when refreshed on a later page and uses the previous boundary on back navigation', async () => {
    const second = { ...item, id: 'old-2', title: 'Segundo aviso' };
    m.getMyNotificationHistory
      .mockResolvedValueOnce({ success: true, data: [item], hasMore: true, nextCursor })
      .mockResolvedValueOnce({ success: true, data: [second], hasMore: false, nextCursor: null })
      .mockResolvedValueOnce({ success: true, data: [second], hasMore: false, nextCursor: null })
      .mockResolvedValueOnce({ success: true, data: [{ ...item, id: 'new', title: 'Nuevo aviso' }], hasMore: true, nextCursor });
    const { rerender } = render(<NotificationHistory {...props} />);
    await screen.findByText('Aviso anterior');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('Segundo aviso');
    rerender(<NotificationHistory {...props} refreshVersion={1} />);
    await screen.findByText('Segundo aviso');
    expect(m.getMyNotificationHistory).toHaveBeenLastCalledWith({ page: 1, after: nextCursor, unreadOnly: false });
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await screen.findByText('Nuevo aviso');
    expect(m.getMyNotificationHistory).toHaveBeenLastCalledWith({ page: 0, after: null, unreadOnly: false });
  });

  it('returns to the previous boundary when all records on a later page disappear', async () => {
    m.getMyNotificationHistory
      .mockResolvedValueOnce({ success: true, data: [item], hasMore: true, nextCursor })
      .mockResolvedValueOnce({ success: true, data: [], hasMore: false, nextCursor: null })
      .mockResolvedValueOnce({ success: true, data: [item], hasMore: false, nextCursor: null });
    render(<NotificationHistory {...props} />);
    await screen.findByText('Aviso anterior');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(m.getMyNotificationHistory).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('Aviso anterior')).toBeTruthy();
    expect(screen.getByText('Página 1')).toBeTruthy();
  });
  it('applies search and date filters only on explicit submission and resets the cursor', async () => {
    m.getMyNotificationHistory.mockResolvedValue({ success: true, data: [item], hasMore: true, nextCursor });
    render(<NotificationHistory {...props} />);
    await screen.findByText('Aviso anterior');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(m.getMyNotificationHistory).toHaveBeenCalledTimes(2));
    await screen.findByText('Aviso anterior');
    fireEvent.click(screen.getByRole('button', { name: 'Buscar y filtrar por fecha' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar por título o contenido' }), { target: { value: '  QA  ' } });
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-25' } });
    expect(m.getMyNotificationHistory).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await waitFor(() => expect(m.getMyNotificationHistory).toHaveBeenLastCalledWith({ page: 0, after: null, unreadOnly: false, searchFilters: { search: 'QA', fromDate: '2026-11-01', toDate: '2026-11-25' } }));
    expect(screen.getByText('Página 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda y fechas' }));
    await waitFor(() => expect(m.getMyNotificationHistory).toHaveBeenLastCalledWith({ page: 0, after: null, unreadOnly: false }));
  });

  it('keeps invalid date ranges from triggering a history query', async () => {
    m.getMyNotificationHistory.mockResolvedValue({ success: true, data: [item], hasMore: false, nextCursor: null });
    render(<NotificationHistory {...props} candidateOnly />);
    await screen.findByText('Aviso anterior');
    fireEvent.click(screen.getByRole('button', { name: 'Buscar y filtrar por fecha' }));
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(m.getMyNotificationHistory).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('combobox', { name: 'Categoría' })).toBeNull();
  });
});
