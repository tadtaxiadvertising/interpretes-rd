// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'react-hot-toast';
import PlatformToaster from './PlatformToaster';

beforeEach(() => { toast.remove(); });
afterEach(() => { cleanup(); toast.remove(); vi.restoreAllMocks(); });

describe('platform feedback', () => {
  it('renders feedback in a single responsive container and dismisses only the selected notice', async () => {
    const dismiss = vi.spyOn(toast, 'dismiss');
    const { container } = render(<PlatformToaster />);
    act(() => {
      toast.success('Guardado correctamente', { id: 'saved', duration: Infinity });
      toast.error('No se pudo guardar', { id: 'failed', duration: Infinity });
    });
    expect(container.querySelectorAll('.platform-toaster')).toHaveLength(1);
    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('No se pudo guardar');
    expect(error.getAttribute('aria-live')).toBe('assertive');
    const row = error.closest('.platform-toast-message')?.parentElement;
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Cerrar aviso' }));
    expect(dismiss).toHaveBeenCalledExactlyOnceWith('failed');
    expect(screen.getByText('Guardado correctamente')).toBeTruthy();
  });

  it('keeps an in-progress notice until the operation updates it', async () => {
    render(<PlatformToaster />);
    act(() => { toast.loading('Procesando', { id: 'work' }); });
    expect(await screen.findByText('Procesando')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cerrar aviso' })).toBeNull();
    act(() => { toast.success('Proceso terminado', { id: 'work', duration: Infinity }); });
    expect(await screen.findByText('Proceso terminado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar aviso' })).toBeTruthy();
  });
});
