// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSVChunkUploader } from './CSVChunkUploader';

const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@/app/actions/production.actions', () => ({ uploadLogChunk: mocks.upload }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

function selectFile(rowCount: number) {
  const file = new File(['CSV'], 'production.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => ['Date,External ID,Minutes', ...Array.from({ length: rowCount }, () => '2026-11-01,TEST,10')].join('\n') });
  fireEvent.change(screen.getByLabelText('Archivo CSV de producción masiva'), { target: { files: [file] } });
}

function count(label: string) {
  return screen.getByText(label).parentElement?.querySelector('dd')?.textContent;
}

describe('bulk production import feedback', () => {
  it('retains confirmed counts, stops before later blocks and blocks direct retries', async () => {
    mocks.upload.mockResolvedValueOnce({ success: true, count: 495, accepted: 498, skipped: 3, rejected: 2 })
      .mockRejectedValueOnce(new Error('PRIVATE_NETWORK_ERROR'));
    render(<CSVChunkUploader />);
    selectFile(1001);
    const form = screen.getByRole('form', { name: 'Importación masiva de producción' });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No se pudo confirmar'));
    expect(count('Filas insertadas')).toBe('495');
    expect(count('Filas omitidas por la base de datos')).toBe('3');
    expect(count('Filas rechazadas en bloques confirmados')).toBe('2');
    expect(count('Bloques confirmados')).toBe('1');
    expect(count('Bloque sin confirmar')).toBe('2');
    expect(count('Registros posteriores no enviados')).toBe('1');
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    fireEvent.submit(form);
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    selectFile(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not report full success when all rows were rejected', async () => {
    mocks.upload.mockResolvedValueOnce({ success: true, count: 0, accepted: 0, skipped: 0, rejected: 1 });
    render(<CSVChunkUploader />);
    selectFile(1);
    fireEvent.submit(screen.getByRole('form', { name: 'Importación masiva de producción' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('filas rechazadas'));
    expect(count('Filas insertadas')).toBe('0');
    expect(count('Filas rechazadas en bloques confirmados')).toBe('1');
  });

  it('preflights malformed later records before sending any earlier block', async () => {
    render(<CSVChunkUploader />);
    const file = new File(['CSV'], 'production.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => ['Date,External ID,Minutes', ...Array(500).fill('2026-11-01,TEST,10'), '2026-11-02,"TEST'].join('\n') });
    fireEvent.change(screen.getByLabelText('Archivo CSV de producción masiva'), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole('form', { name: 'Importación masiva de producción' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Corrige el archivo'));
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
