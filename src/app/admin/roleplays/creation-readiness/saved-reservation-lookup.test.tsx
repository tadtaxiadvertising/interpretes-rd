// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SavedReservationLookup from './saved-reservation-lookup';

const key = '123e4567-e89b-42d3-a456-426614174000';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('saved direct reservation lookup', () => {
  it('validates locally and queries only on explicit submission', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, data: { status: 'PUBLICATION_RECORDED' } }));
    vi.stubGlobal('fetch', fetcher);
    render(<SavedReservationLookup />);
    const input = screen.getByLabelText('Referencia de la reserva directa guardada');
    const submit = screen.getByRole('button', { name: 'Consultar reserva guardada' });
    fireEvent.change(input, { target: { value: 'signed-token' } });
    fireEvent.click(submit);
    expect(screen.getByRole('alert').textContent).toContain('UUID válida');
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ' ' + key + ' ' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(submit);
    await screen.findByText(/El registro indica una publicación/);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/admin/roleplays/uploads/status', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ requestKey: key }), cache: 'no-store',
    }));
    expect(screen.queryByRole('button', { name: /Crear|Continuar creación/ })).toBeNull();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('prevents concurrent queries and preserves the reference on failure', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    render(<SavedReservationLookup />);
    const input = screen.getByLabelText('Referencia de la reserva directa guardada');
    const submit = screen.getByRole('button', { name: 'Consultar reserva guardada' });
    fireEvent.change(input, { target: { value: key } });
    fireEvent.click(submit);
    expect(input).toHaveProperty('disabled', true);
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.submit(submit.closest('form')!);
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(Response.json({ error: 'PRIVATE_PROVIDER_DETAIL' }, { status: 503 }));
    await screen.findByText(/No se pudo consultar el registro/);
    expect(input).toHaveProperty('value', key);
    expect(submit).toHaveProperty('disabled', false);
    expect(document.body.textContent).not.toContain('PRIVATE_PROVIDER_DETAIL');
  });
});
