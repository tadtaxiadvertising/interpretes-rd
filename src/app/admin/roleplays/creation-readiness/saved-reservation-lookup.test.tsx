// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SavedReservationLookup from './saved-reservation-lookup';

const key = '123e4567-e89b-42d3-a456-426614174000';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('saved direct reservation lookup', () => {
  it('keeps the live region mounted and clears a previous result without another request', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, data: { status: 'NOT_FOUND' } }));
    vi.stubGlobal('fetch', fetcher);
    render(<SavedReservationLookup />);
    const input = screen.getByLabelText('Referencia de la reserva directa guardada');
    const live = screen.getByRole('status');
    expect(live.textContent).toBe('');
    expect(input.getAttribute('enterkeyhint')).toBe('search');
    fireEvent.change(input, { target: { value: key } });
    fireEvent.submit(screen.getByRole('button', { name: 'Consultar reserva guardada' }).closest('form')!);
    await screen.findByText(/No se encontró una reserva/);
    expect(screen.getByRole('status')).toBe(live);
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar referencia' }));
    expect(input).toHaveProperty('value', '');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('status')).toBe(live);
    expect(live.textContent).toBe('');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['session-confirmed', '../external', 'https://external.example', undefined])(
    'offers only a safe confirmed administrative session link (%s)', async sessionId => {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, data: {
        status: 'PUBLICATION_CONFIRMED', sessionId,
      } }));
      vi.stubGlobal('fetch', fetcher);
      render(<SavedReservationLookup />);
      fireEvent.change(screen.getByLabelText('Referencia de la reserva directa guardada'), { target: { value: key } });
      fireEvent.click(screen.getByRole('button', { name: 'Consultar reserva guardada' }));
      if (sessionId === 'session-confirmed') {
        const link = await screen.findByRole('link', { name: 'Ver roleplay confirmado (nueva pestaña)' });
        expect(link.getAttribute('href')).toBe('/admin/roleplays/session-confirmed');
        expect(link.getAttribute('target')).toBe('_blank');
      } else {
        await screen.findByText(/El registro requiere revisión administrativa/);
        expect(screen.queryByRole('link', { name: /Ver roleplay confirmado/ })).toBeNull();
      }
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each([false, true])('shows verified progress and a dated expiry snapshot (expired=%s)', async expired => {
    const observedAt = '2026-11-28T03:00:00.000Z';
    const expiresAt = expired ? '2026-11-28T02:59:00.000Z' : '2026-11-28T03:04:30.000Z';
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, data: {
      status: expired ? 'EXPIRED' : 'RESERVED',
      progress: { total: 5, recordedVerifiedCount: 2, observedAt, expiresAt },
    } }));
    vi.stubGlobal('fetch', fetcher);
    render(<SavedReservationLookup />);
    const input = screen.getByLabelText('Referencia de la reserva directa guardada');
    fireEvent.change(input, { target: { value: key } });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar reserva guardada' }));
    const progress = await screen.findByRole('progressbar', { name: /Verificación registrada: 2 de 5 audios/ });
    expect(progress).toHaveProperty('value', 2);
    expect(progress).toHaveProperty('max', 5);
    expect(screen.getByText(expired ? 'Caducada al consultar' : '4 min 30 s')).toBeTruthy();
    expect(screen.getByText('2026-11-28 03:00:00 UTC')).toBeTruthy();
    expect(screen.getByText(/Resultado puntual del registro/)).toBeTruthy();
    expect(fetcher).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('does not present malformed progress even when the status is recognized', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, data: {
      status: 'RESERVED',
      progress: { total: 2, recordedVerifiedCount: 3, observedAt: '2026-11-28T03:00:00.000Z', expiresAt: '2026-11-28T03:01:00.000Z' },
    } }));
    vi.stubGlobal('fetch', fetcher);
    render(<SavedReservationLookup />);
    fireEvent.change(screen.getByLabelText('Referencia de la reserva directa guardada'), { target: { value: key } });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar reserva guardada' }));
    await screen.findByText(/La reserva figura como registrada/);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('validates locally and queries only on explicit submission', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, data: { status: 'PUBLICATION_RECORDED' } }));
    vi.stubGlobal('fetch', fetcher);
    render(<SavedReservationLookup />);
    const input = screen.getByLabelText('Referencia de la reserva directa guardada');
    const submit = screen.getByRole('button', { name: 'Consultar reserva guardada' });
    fireEvent.change(input, { target: { value: 'signed-token' } });
    fireEvent.click(submit);
    expect(screen.getByRole('alert').textContent).toContain('UUID válida');
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-describedby')).toBe('saved-reservation-help saved-reservation-error');
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ' ' + key + ' ' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-describedby')).toBe('saved-reservation-help');
    fireEvent.click(submit);
    await screen.findByText(/El registro indica una publicación/);
    expect(screen.getByRole('link', { name: 'Consultar roleplays existentes (nueva pestaña)' }).getAttribute('target')).toBe('_blank');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/admin/roleplays/uploads/status', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ requestKey: key }), cache: 'no-store',
    }));
    expect(screen.queryByRole('button', { name: /Crear|Continuar creación/ })).toBeNull();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('status').textContent).toBe('');
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
    expect(submit.textContent).toBe('Consultando reserva…');
    expect(screen.getByRole('button', { name: 'Limpiar referencia' })).toHaveProperty('disabled', true);
    fireEvent.submit(submit.closest('form')!);
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(Response.json({ error: 'PRIVATE_PROVIDER_DETAIL' }, { status: 503 }));
    await screen.findByText(/No se pudo consultar el registro/);
    expect(input).toHaveProperty('value', key);
    expect(submit).toHaveProperty('disabled', false);
    expect(document.body.textContent).not.toContain('PRIVATE_PROVIDER_DETAIL');
  });
});
