// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ generate: vi.fn(), success: vi.fn() }));
vi.mock('@/app/actions/payroll', () => ({ generatePayrollPeriod: m.generate }));
vi.mock('react-hot-toast', () => ({ toast: { success: m.success } }));
import { GeneratePayrollButton } from './GeneratePayrollButton';

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
function open(start = '2026-11-01', end = '2026-11-15') {
  render(<GeneratePayrollButton />);
  fireEvent.click(screen.getByRole('button', { name: 'Generar nómina' }));
  fireEvent.change(screen.getByLabelText('Inicio del período'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('Fin del período'), { target: { value: end } });
  return screen.getByRole('button', { name: 'Generar', exact: true }).closest('form')!;
}

describe('payroll generation feedback', () => {
  it('prevents duplicate submissions and reports a single confirmed success', async () => {
    let resolve!: (value: unknown) => void;
    m.generate.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const form = open();
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(m.generate).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(m.success).not.toHaveBeenCalled();
    await act(async () => { resolve({ success: true, data: { message: 'Nómina generada' } }); });
    expect(m.success).toHaveBeenCalledExactlyOnceWith('Nómina generada');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('validates reversed dates before calling the server', () => {
    fireEvent.submit(open('2026-11-15', '2026-11-01'));
    expect(screen.getByRole('alert').textContent).toContain('fecha inicial');
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.success).not.toHaveBeenCalled();
  });

  it('does not report success on a partial failure or ambiguous network error', async () => {
    m.generate.mockResolvedValueOnce({ success: false, error: 'Nómina parcialmente procesada' }).mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const form = open();
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('parcialmente'));
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No se pudo confirmar'));
    expect(screen.queryByText(/PRIVATE_PASSWORD/)).toBeNull();
    expect(m.success).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
