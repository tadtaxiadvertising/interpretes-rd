// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ accounts: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock('@/app/actions/account-rates', () => ({ getAccounts: m.accounts, setInterpreterAccountRate: m.save, deleteInterpreterAccountRate: m.remove }));
import { AccountRateManager } from './AccountRateManager';
const account = { id: 1, name: 'Cuenta ejemplo', client: { name: 'Cliente' }, company: null };
const props = { interpreterId: 7, initialRates: [{ accountId: 1, tariffPerHour: 100 }] };
beforeEach(() => { vi.resetAllMocks(); m.accounts.mockResolvedValue({ success: true, data: [account] }); });
afterEach(cleanup);

describe('account rate feedback', () => {
  it('preserves existing rates when the directory fails and recovers only after explicit retry', async () => {
    m.accounts.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    render(<AccountRateManager {...props} />);
    expect((await screen.findByRole('alert')).textContent).not.toContain('PRIVATE_PASSWORD');
    expect(screen.getByText('RD$100.00/hr')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Eliminar tarifa' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar carga' }));
    await screen.findByRole('option', { name: /Cuenta ejemplo/ });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(m.accounts).toHaveBeenCalledTimes(2);
  });

  it('updates one existing rate only once despite repeated clicks', async () => {
    let finish!: (value: unknown) => void;
    m.save.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<AccountRateManager {...props} />);
    await screen.findByRole('option', { name: /Cuenta ejemplo/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Cuenta para tarifa especial' }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
    const button = screen.getByRole('button', { name: 'Actualizar tarifa' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(m.save).toHaveBeenCalledExactlyOnceWith(7, 1, 150);
    await act(async () => { finish({ success: true }); });
    expect(screen.getByRole('status').textContent).toContain('Tarifa guardada');
    expect(screen.getByText('RD$150.00/hr')).toBeTruthy();
  });

  it('retains the rate if deletion fails and never deletes on opening the dialog', async () => {
    m.remove.mockResolvedValueOnce({ success: false });
    render(<AccountRateManager {...props} />);
    await screen.findByRole('option', { name: /Cuenta ejemplo/ });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar tarifa' }));
    expect(m.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar tarifa especial' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No se pudo eliminar'));
    expect(m.remove).toHaveBeenCalledExactlyOnceWith(7, 1);
    expect(screen.getByText('RD$100.00/hr')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
