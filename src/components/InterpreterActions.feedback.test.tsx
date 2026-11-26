// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ reset: vi.fn(), remove: vi.fn(), success: vi.fn(), refresh: vi.fn() }));
vi.mock('@/app/actions/interpreters', () => ({ resetInterpreterPassword: m.reset, deleteInterpreter: m.remove }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock('react-hot-toast', () => ({ toast: { success: m.success } }));
vi.mock('./InterpreterForm', () => ({ InterpreterForm: () => null }));
import { InterpreterActions } from './InterpreterActions';
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
function open(label: string) {
  render(<InterpreterActions interpreter={{ id: 7, name: 'Ejemplo', emailCorporativo: null }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Acciones del intérprete' }));
  fireEvent.click(screen.getByRole('button', { name: label }));
}

describe('interpreter operation feedback', () => {
  it('blocks duplicate password submissions and reports one confirmed success', async () => {
    let finish!: (value: unknown) => void;
    m.reset.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    open('Reset Password');
    fireEvent.change(screen.getByPlaceholderText('Min 6 characters'), { target: { value: 'example-password' } });
    const form = screen.getByRole('button', { name: 'Actualizar contraseña' }).closest('form')!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(m.reset).toHaveBeenCalledTimes(1);
    expect(m.success).not.toHaveBeenCalled();
    await act(async () => { finish({ success: true }); });
    expect(m.success).toHaveBeenCalledExactlyOnceWith('Contraseña actualizada correctamente');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('blocks a retry after an uncertain deletion without exposing the exception', async () => {
    m.remove.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    open('Delete Account');
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No se pudo confirmar la baja'));
    expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE_PASSWORD');
    expect((screen.getByRole('button', { name: 'Revisión necesaria' }) as HTMLButtonElement).disabled).toBe(true);
    expect(m.success).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
