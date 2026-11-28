import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CopyDiagnostic from './copy-diagnostic';

const evidence = 'Diagnóstico de creación segura\nResultado puntual; no autoriza activar el piloto.';

function clipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
}
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('diagnostic clipboard action', () => {
  it('copies the exact evidence and confirms success only after resolution', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard({ writeText });
    render(<CopyDiagnostic evidence={evidence} />);
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico' }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(evidence);
    expect(screen.getByRole('button', { name: 'Copiando…' })).toBeDisabled();
    expect(screen.getByRole('status')).not.toHaveTextContent('Diagnóstico copiado.');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Diagnóstico copiado.'));
    expect(screen.getByRole('button', { name: 'Copiar diagnóstico' })).toBeEnabled();
  });

  it('retains the visible evidence after denial and allows a retry', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
    clipboard({ writeText });
    const { container } = render(<CopyDiagnostic evidence={evidence} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No se pudo copiar automáticamente'));
    expect(container.querySelector('pre')?.textContent).toBe(evidence);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Diagnóstico copiado.'));
  });

  it('offers manual selection when the clipboard API is unavailable', async () => {
    clipboard(undefined);
    render(<CopyDiagnostic evidence={evidence} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Selecciona y copia el resumen manualmente.'));
  });
});
