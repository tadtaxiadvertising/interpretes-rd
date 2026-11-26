// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  deleteUserAccess: vi.fn(),
  updateUserProfile: vi.fn(),
  updateUserPassword: vi.fn(),
  updateUserRole: vi.fn(),
  getAllInterpretersList: vi.fn(),
  linkUserToInterpreter: vi.fn(),
}));
vi.mock('@/app/actions/admin-users', () => mocks);
vi.mock('react-hot-toast', () => ({ toast: { success: mocks.toastSuccess } }));
import { UserActions } from './UserActions';

const user = {
  id: 'supabase-test-id',
  email: 'test@example.test',
  displayName: 'Test User',
  interpreterId: null,
  role: 'interpreter',
};

function openRevocation() {
  render(<UserActions user={user as never} />);
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByRole('button', { name: /Revocar acceso Supabase/i }));
}

describe('admin user access controls communicate the provider scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('offers only implemented roles, including candidate, never unsupported manager/recruiter', () => {
    render(<UserActions user={user as never} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getByRole('button', { name: 'candidate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'interpreter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'admin' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'manager' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'recruiter' })).toBeNull();
  });

  it('keeps the role menu open and displays the server rejection instead of claiming success', async () => {
    mocks.updateUserRole.mockResolvedValueOnce({
      success: false, error: 'El administrador protegido no puede perder su rol.',
    });
    render(<UserActions user={user as never} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'candidate' }));
    expect((await screen.findByRole('alert')).textContent).toContain('El administrador protegido no puede perder su rol.');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'candidate' })).toBeTruthy();
  });

  it('warns that legacy NextAuth access is not automatically revoked before confirmation', () => {
    openRevocation();
    expect(screen.getByRole('alert').textContent).toContain('NextAuth');
    expect(screen.getByRole('alert').textContent).toContain('no revoca automáticamente');
  });

  it('discloses legacy credential checks after a successful Supabase revocation', async () => {
    mocks.deleteUserAccess.mockResolvedValueOnce({ success: true });
    openRevocation();
    fireEvent.click(screen.getByRole('button', { name: 'Revocar Supabase Auth' }));
    await waitFor(() => expect(mocks.deleteUserAccess).toHaveBeenCalledWith('supabase-test-id'));
    expect(globalThis.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith(expect.stringContaining('NextAuth'), { duration: 12000 }));
  });

  it('surfaces partial failures rather than pretending the user was deleted', async () => {
    mocks.deleteUserAccess.mockResolvedValueOnce({
      success: false,
      partial: true,
      error: 'Acceso de autenticación revocado; la limpieza del perfil local quedó pendiente de revisión.',
    });
    openRevocation();
    fireEvent.click(screen.getByRole('button', { name: 'Revocar Supabase Auth' }));
    await screen.findByText(/limpieza del perfil local/);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Revocar Supabase Auth' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('prevents a second role mutation while the first is pending', async () => {
    let finish!: (value: unknown) => void;
    mocks.updateUserRole.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<UserActions user={user as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acciones del usuario' }));
    const button = screen.getByRole('button', { name: 'candidate' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(mocks.updateUserRole).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ success: true }); });
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('Rol actualizado correctamente');
    expect(globalThis.alert).not.toHaveBeenCalled();
  });

  it('blocks link changes when the interpreter directory failed to load', async () => {
    mocks.getAllInterpretersList.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    render(<UserActions user={user as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Acciones del usuario' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular ID Intérprete' }));
    expect((await screen.findByRole('alert')).textContent).not.toContain('PRIVATE_PASSWORD');
    const save = screen.getByRole('button', { name: 'Guardar Enlace' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(mocks.linkUserToInterpreter).not.toHaveBeenCalled();
  });

  it('does not revoke access when the explicit confirmation is declined', () => {
    openRevocation();
    vi.mocked(globalThis.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Revocar Supabase Auth' }));
    expect(mocks.deleteUserAccess).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
