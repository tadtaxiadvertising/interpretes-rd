// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock('@/app/actions/account-rates', () => ({ createAccount: m.create, updateAccount: m.update, deleteAccount: m.remove }));
import { AccountManager } from './AccountManager';

const account = { id: 1, name: 'Cuenta ejemplo', description: null, clientId: 2, clientName: 'Cliente' };
const props = { initialAccounts: [account], clients: [{ id: 2, name: 'Cliente' }] };
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('account operation feedback', () => {
  it('prevents duplicate creation and displays a single confirmed result', async () => {
    let finish!: (value: unknown) => void;
    m.create.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<AccountManager {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nueva Cuenta' }));
    fireEvent.change(screen.getByLabelText('Cliente propietario'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Nombre de la cuenta'), { target: { value: 'Nueva cuenta' } });
    const form = screen.getByRole('button', { name: 'Crear Cuenta' }).closest('form')!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(m.create).toHaveBeenCalledExactlyOnceWith('Nueva cuenta', '', 2);
    await act(async () => { finish({ success: true, data: { ...account, id: 3, name: 'Nueva cuenta' } }); });
    expect(screen.getByRole('status').textContent).toContain('Cuenta creada');
    expect(screen.getByText('Nueva cuenta')).toBeTruthy();
  });

  it('shows an update rejection and preserves the editable values', async () => {
    m.update.mockResolvedValueOnce({ success: false, error: 'Nombre duplicado' });
    render(<AccountManager {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar cuenta: Cuenta ejemplo' }));
    fireEvent.change(screen.getByLabelText('Editar nombre'), { target: { value: 'Otro nombre' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nombre duplicado');
    expect((screen.getByLabelText('Editar nombre') as HTMLInputElement).value).toBe('Otro nombre');
  });

  it('requires explicit deletion and blocks an uncertain retry', async () => {
    m.remove.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    render(<AccountManager {...props} />);
    const open = screen.getByRole('button', { name: 'Eliminar cuenta: Cuenta ejemplo' });
    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar', exact: true }));
    expect(m.remove).not.toHaveBeenCalled();
    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar cuenta', exact: true }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No se pudo confirmar'));
    expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE_PASSWORD');
    expect((screen.getByRole('button', { name: 'Eliminar cuenta', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Cuenta ejemplo', { selector: 'strong' })).toBeTruthy();
  });
});
