// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  deleteUserAccess: vi.fn(),
  updateUserProfile: vi.fn(),
  updateUserPassword: vi.fn(),
  updateUserRole: vi.fn(),
  getAllInterpretersList: vi.fn(),
  linkUserToInterpreter: vi.fn(),
}));
vi.mock('@/app/actions/admin-users', () => mocks);
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
    await waitFor(() => expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('NextAuth')));
  });

  it('surfaces partial failures rather than pretending the user was deleted', async () => {
    mocks.deleteUserAccess.mockResolvedValueOnce({
      success: false,
      partial: true,
      error: 'Acceso de autenticación revocado; la limpieza del perfil local quedó pendiente de revisión.',
    });
    openRevocation();
    fireEvent.click(screen.getByRole('button', { name: 'Revocar Supabase Auth' }));
    await waitFor(() =>
      expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('limpieza del perfil local')),
    );
  });
});
