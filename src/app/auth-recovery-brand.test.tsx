import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('@/app/actions/auth', () => ({
  requestPasswordReset: m.requestPasswordReset,
  updatePassword: m.updatePassword,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: m.routerPush }),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/ThemeSwitcher', () => ({
  ThemeSwitcher: () => <button type="button" aria-label="Cambiar apariencia">Tema</button>,
}));

import ForgotPasswordPage from './forgot-password/page';
import ResetPasswordPage from './reset-password/page';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('Branded account recovery', () => {
  it('offers a single, clear recovery form without inert role selectors', async () => {
    m.requestPasswordReset.mockResolvedValue({ success: true });
    render(<ForgotPasswordPage />);

    expect(screen.getByRole('heading', { name: 'Intérpretes RD' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cambiar apariencia' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Administrador' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Intérprete' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'interprete@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Revisa tu correo' })).toBeTruthy());
    expect(m.requestPasswordReset).toHaveBeenCalledTimes(1);
    const data = m.requestPasswordReset.mock.calls[0][0] as FormData;
    expect(data.get('email')).toBe('interprete@example.com');
  });

  it('keeps password field names unchanged and presents Spanish feedback', async () => {
    m.updatePassword.mockResolvedValue({
      success: false, error: 'Las contraseñas no coinciden o están vacías.',
    });
    render(<ResetPasswordPage />);

    expect(screen.getByRole('heading', { name: 'Nueva contraseña' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cambiar apariencia' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), {
      target: { value: 'Nueva-Clave-Segura-123!' },
    });
    fireEvent.change(screen.getByLabelText('Confirmar nueva contraseña'), {
      target: { value: 'Nueva-Clave-Segura-123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }));

    await waitFor(() => expect(screen.getByText('Las contraseñas no coinciden o están vacías.')).toBeTruthy());
    expect(m.updatePassword).toHaveBeenCalledTimes(1);
    const data = m.updatePassword.mock.calls[0][0] as FormData;
    expect(data.get('password')).toBe('Nueva-Clave-Segura-123!');
    expect(data.get('confirmPassword')).toBe('Nueva-Clave-Segura-123!');
  });
});
