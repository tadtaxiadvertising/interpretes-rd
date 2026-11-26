// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('@/app/actions/admin-users', () => ({ syncAllSupabaseUsers: m.sync }));
import { SyncUsersButton } from './SyncUsersButton';
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('user sync feedback', () => {
  it('coalesces clicks during a pending operation and leaves a single visible result', async () => {
    let resolve!: (value: unknown) => void;
    m.sync.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<SyncUsersButton />);
    const button = screen.getByRole('button', { name: 'Sincronizar Supabase' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(m.sync).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await act(async () => { resolve({ success: true, syncedCount: 3 }); });
    expect(screen.getByRole('status').textContent).toContain('3 perfiles');
    expect(button.getAttribute('aria-busy')).toBe('false');
    m.sync.mockResolvedValueOnce({ success: true, syncedCount: 0 });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('No hubo perfiles nuevos'));
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('shows a safe inline error and clears it on a later successful sync', async () => {
    m.sync.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD')).mockResolvedValueOnce({ success: true, syncedCount: 1 });
    render(<SyncUsersButton />);
    const button = screen.getByRole('button', { name: 'Sincronizar Supabase' });
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).not.toContain('PRIVATE_PASSWORD');
    fireEvent.click(button);
    await screen.findByRole('status');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
