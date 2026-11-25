// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSVImporter } from './CSVImporter';

const request = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', request); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  render(<CSVImporter type="production" title="Producción" description="Prueba" />);
  const input = screen.getByLabelText('Archivo CSV: Producción') as HTMLInputElement;
  const select = (name = 'sample.csv') => fireEvent.change(input, { target: { files: [new File(['Date,Minutes'], name, { type: 'text/csv' })] } });
  const button = () => screen.getByRole('button', { name: /Procesar importación|Procesando/ }) as HTMLButtonElement;
  select();
  return { input, select, button };
}

describe('CSV import feedback and retry safety', () => {
  it('shows partial results without exposing raw server errors and clears them on a new selection', async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ successCount: 2, errorCount: 1, errors: ['Row 3: PRIVATE_SERVER_DETAILS'] }) });
    const { select, button } = setup();
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Importación parcial'));
    expect(screen.getByText('Fila de datos 3: verifica los valores y las referencias.')).toBeTruthy();
    expect(screen.queryByText(/PRIVATE_SERVER_DETAILS/)).toBeNull();
    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(request).toHaveBeenCalledOnce();
    select('next.csv');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Filas importadas:')).toBeNull();
    expect(button().disabled).toBe(false);
  });

  it('blocks another request and file changes while pending', async () => {
    let resolve!: (value: unknown) => void;
    request.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { input, button } = setup();
    act(() => { fireEvent.click(button()); fireEvent.click(button()); });
    expect(request).toHaveBeenCalledOnce();
    expect(input.disabled).toBe(true);
    await act(async () => resolve({ ok: true, json: async () => ({ successCount: 3, errorCount: 0, errors: [] }) }));
    expect(screen.getByRole('status').textContent).toBe('Importación completada.');
    expect(button().disabled).toBe(true);
  });

  it('does not claim success for zero rows or uncertain responses', async () => {
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ successCount: 0, errorCount: 0, errors: [] }) });
    const { select, button } = setup();
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No se confirmaron filas'));
    select('another.csv');
    request.mockRejectedValueOnce(new Error('PRIVATE_NETWORK_DETAILS'));
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No se pudo confirmar'));
    expect(button().disabled).toBe(true);
    expect(screen.queryByText(/PRIVATE_NETWORK_DETAILS/)).toBeNull();
  });
});
