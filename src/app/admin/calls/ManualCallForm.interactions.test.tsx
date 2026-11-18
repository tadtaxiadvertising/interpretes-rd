// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ addManualCall: vi.fn() }));
vi.mock('@/app/actions/calls', () => ({ addManualCall: mocks.addManualCall }));
import ManualCallForm from '../ManualCallForm';

function openForm() {
  render(<ManualCallForm interpreters={[{ id: 7, name: 'Synthetic Interpreter' }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Manual Call' }));
  const form = document.querySelector('form') as HTMLFormElement;
  const interpreter = form.querySelector('[name="interpreterId"]') as HTMLSelectElement;
  const duration = form.querySelector('[name="durationMinutes"]') as HTMLInputElement;
  fireEvent.change(interpreter, { target: { value: '7' } });
  fireEvent.change(duration, { target: { value: '2.5' } });
  fireEvent.change(screen.getByLabelText('Start Time'), { target: { value: '2026-11-18T09:30' } });
  return form;
}

describe('admin manual call timezone and duplicate safeguards', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('submits the browser-local wall time as an explicit UTC timestamp', async () => {
    mocks.addManualCall.mockResolvedValueOnce({ success: true, data: { id: 77 } });
    const form = openForm();
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.addManualCall).toHaveBeenCalledOnce());
    const formData = mocks.addManualCall.mock.calls[0][0] as FormData;
    expect(formData.get('startedAt')).toBe(new Date('2026-11-18T09:30').toISOString());
    expect(formData.get('durationMinutes')).toBe('2.5');
  });

  it('synchronously blocks two submits while the first save is pending', async () => {
    let finish!: (r: { success: boolean; data?: { id: number } }) => void;
    mocks.addManualCall.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const form = openForm();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.addManualCall).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'Cerrar registro manual' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ success: true, data: { id: 77 } }));
    await waitFor(() => expect(document.querySelector('form')).toBeNull());
  });

  it('refuses to blindly retry if the outcome of a network error is unknown', async () => {
    mocks.addManualCall.mockRejectedValueOnce(new Error('PRIVATE_DB_PASSWORD'));
    const form = openForm();
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Revisa el historial'));
    expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE_DB_PASSWORD');
    expect((screen.getByRole('button', { name: 'Save Call Record' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Revisar historial').getAttribute('href')).toBe('/admin/calls');
    fireEvent.submit(form);
    expect(mocks.addManualCall).toHaveBeenCalledOnce();
  });

  it('allows correcting rejected input without revealing raw server messages', async () => {
    mocks.addManualCall.mockResolvedValueOnce({
      success: false, code: 'VALIDATION_ERROR', error: 'PRIVATE_DATABASE_MESSAGE',
    });
    const form = openForm();
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No se guardó'));
    expect(screen.getByRole('alert').textContent).not.toContain('PRIVATE_DATABASE_MESSAGE');
    expect((screen.getByRole('button', { name: 'Save Call Record' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
