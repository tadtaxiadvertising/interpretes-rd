// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ quickLog: vi.fn(), refresh: vi.fn() }));
vi.mock('@/app/actions/quick-log', () => ({ quickLog: mocks.quickLog }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { QuickLogButton } from './QuickLogButton';

function openAndEnter(minutes = '4', seconds = '15') {
  render(<QuickLogButton />);
  fireEvent.click(screen.getByRole('button', { name: 'Registro Rápido' }));
  fireEvent.change(screen.getByLabelText('Minutos'), { target: { value: minutes } });
  fireEvent.change(screen.getByLabelText('Segundos'), { target: { value: seconds } });
  return screen.getByRole('form', { name: 'Formulario de registro rápido' });
}

describe('Quick Log button protects against duplicate writes', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('synchronously blocks two submits while the first server action is pending', async () => {
    let finish!: (result: { success: true; data: { id: number } }) => void;
    mocks.quickLog.mockImplementationOnce(() =>
      new Promise(resolve => { finish = resolve; }),
    );
    const form = openAndEnter();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.quickLog).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Cerrar registro rápido' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Minutos') as HTMLInputElement).disabled).toBe(true);

    await act(async () => { finish({ success: true, data: { id: 18 } }); });
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Formulario de registro rápido' })).toBeNull();
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('blocks blind retries after a network failure with unknown commit outcome', async () => {
    mocks.quickLog.mockRejectedValueOnce(new Error('postgresql://PRIVATE_PASSWORD@internal.invalid'));
    const form = openAndEnter();
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Revisa tu historial'));
    expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE_PASSWORD');
    expect((screen.getByLabelText('Minutos') as HTMLInputElement).value).toBe('4');
    expect((screen.getByRole('button', { name: 'Guardar Registro' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(form);
    expect(mocks.quickLog).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('allows a deliberate resend only after acknowledging the reviewed history', async () => {
    mocks.quickLog.mockRejectedValueOnce(new Error('UNCERTAIN_NETWORK_OUTCOME'));
    const form = openAndEnter('6', '15');
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Revisa tu historial'));
    const historyLink = screen.getByRole('link', { name: 'Abrir historial de llamadas en otra pestaña' });
    expect(historyLink.getAttribute('href')).toBe('/dashboard');
    expect(historyLink.getAttribute('target')).toBe('_blank');

    fireEvent.submit(form);
    expect(mocks.quickLog).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', {
      name: 'Confirmo que la llamada no aparece; habilitar registro',
    }));
    expect((screen.getByRole('button', { name: 'Guardar Registro' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('Minutos') as HTMLInputElement).value).toBe('6');

    mocks.quickLog.mockResolvedValueOnce({ success: true, data: { id: 55 } });
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.quickLog).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Formulario de registro rápido' })).toBeNull());
  });

  it('does not mark a committed call uncertain if a client refresh throws', async () => {
    mocks.quickLog.mockResolvedValueOnce({ success: true, data: { id: 44 } });
    mocks.refresh.mockImplementationOnce(() => { throw new Error('REFRESH_FAILURE'); });
    const form = openAndEnter();
    fireEvent.submit(form);
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Formulario de registro rápido' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Registro Rápido' }));
    expect((screen.getByRole('button', { name: 'Guardar Registro' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.quickLog).toHaveBeenCalledOnce();
  });

  it('keeps the form available after an explicit payroll conflict without leaking server errors', async () => {
    mocks.quickLog.mockResolvedValueOnce({
      success: false, code: 'CONFLICT', error: 'PRIVATE_DATABASE_CREDENTIAL',
    });
    const form = openAndEnter();
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No se guardó'));
    expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE_DATABASE_CREDENTIAL');
    expect((screen.getByRole('button', { name: 'Guardar Registro' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not submit zero, invalid seconds or fractional minutes', () => {
    const form = openAndEnter('0', '0');
    expect((screen.getByRole('button', { name: 'Guardar Registro' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(form);
    fireEvent.change(screen.getByLabelText('Segundos'), { target: { value: '60' } });
    fireEvent.submit(form);
    fireEvent.change(screen.getByLabelText('Minutos'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Segundos'), { target: { value: '0' } });
    fireEvent.submit(form);
    expect(mocks.quickLog).not.toHaveBeenCalled();
  });
});
