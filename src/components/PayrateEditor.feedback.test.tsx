// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/app/actions/payrates', () => ({ updatePayrate: m.update }));
vi.mock('./AccountRateManager', () => ({ AccountRateManager: () => null }));
import { PayrateEditor } from './PayrateEditor';
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

function open() {
  render(<table><tbody><PayrateEditor interpreter={{ id: 7, name: 'Ejemplo', externalId: '7', campaign: null, status: 'Activo', tariffPerMinute: 2, accountRates: [] }} /></tbody></table>);
  fireEvent.click(screen.getByRole('button', { name: 'Editar tarifa' }));
  return screen.getByRole('spinbutton');
}

describe('general payrate feedback', () => {
  it('previews the effective amount and submits one rounded rate', async () => {
    let finish!: (value: unknown) => void;
    m.update.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const input = open();
    fireEvent.change(input, { target: { value: '127.50' } });
    expect(screen.getByText(/Se guardará RD\$127.80\/hora/)).toBeTruthy();
    expect(screen.getByText(/se ajusta a la precisión/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Guardar tarifa' });
    act(() => { fireEvent.click(save); fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(m.update).toHaveBeenCalledExactlyOnceWith(7, 2.13);
    await act(async () => { finish({ success: true, data: { oldRate: 2, newRate: 2.13 } }); });
    expect(screen.getByText('RD$127.80/hr')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('actualizada');
  });
  it('reports unchanged values without claiming another change', async () => {
    m.update.mockResolvedValueOnce({ success: true, data: { oldRate: 2, newRate: 2 } });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar tarifa' }));
    expect((await screen.findByRole('status')).textContent).toContain('No se registró otro cambio');
  });
  it('blocks further writes after a concurrent conflict', async () => {
    m.update.mockResolvedValueOnce({ success: false, code: 'CONFLICT', error: 'Actualiza la página y verifica el valor' });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar tarifa' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Actualiza la página'));
    expect((screen.getByRole('button', { name: 'Guardar tarifa' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
