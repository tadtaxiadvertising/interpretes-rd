// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LocalVadAssistant from './LocalVadAssistant';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reuse VAD results without re-decoding or uploading the MP3', () => {
  it('reviews cached timing metadata and adds only non-overlapping cuts', () => {
    const fetchMock = vi.fn(() => { throw new Error('No network allowed in local mode'); });
    const decoder = vi.fn(() => { throw new Error('No second AudioContext allowed'); });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('AudioContext', decoder);
    const apply = vi.fn();

    render(<LocalVadAssistant
      snapshot={{ status: 'ready', segments: [
        { start: 1, end: 4, signalLevel: 0.8 },
        { start: 10, end: 14, signalLevel: 0.8 },
      ] }}
      duration={20}
      existing={[{ start: 9, end: 15 }]}
      onApply={apply}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar actividad local' }));
    expect(screen.getByText(/regiones omitidas por duración, solapamientos o cuota/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Añadir 1 corte revisable' }));
    expect(apply).toHaveBeenCalledWith([{ start: 1, end: 4 }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(decoder).not.toHaveBeenCalled();
  });

  it('lets administrators deselect false positives without any server request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const apply = vi.fn();
    render(<LocalVadAssistant
      snapshot={{ status: 'ready', segments: [
        { start: 1, end: 4, signalLevel: 0.7 },
        { start: 8, end: 12, signalLevel: 0.8 },
      ] }}
      duration={20} existing={[]} onApply={apply}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar actividad local' }));
    const first = screen.getByRole('checkbox', { name: 'Incluir región 1' }) as HTMLInputElement;
    const second = screen.getByRole('checkbox', { name: 'Incluir región 2' }) as HTMLInputElement;
    expect(first.checked).toBe(true);
    expect(second.checked).toBe(true);

    fireEvent.click(second);
    expect(second.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Añadir 1 corte revisable' }));
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith([{ start: 1, end: 4 }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables applying cuts when all proposed regions are deselected', () => {
    const apply = vi.fn();
    render(<LocalVadAssistant
      snapshot={{ status: 'ready', segments: [{ start: 2, end: 5, signalLevel: 0.6 }] }}
      duration={10} existing={[]} onApply={apply}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar actividad local' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Incluir región 1' }));
    const button = screen.getByRole('button', { name: 'Añadir 0 cortes revisables' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(apply).not.toHaveBeenCalled();
  });

  it('explains limited memory and missing browser decoding without trying the server', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<LocalVadAssistant
      snapshot={{ status: 'limited', segments: [] }} duration={300}
      existing={[]} onApply={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('hasta 4 minutos y 8 MiB');
    expect((screen.getByRole('button', { name: 'Revisar actividad local' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<LocalVadAssistant
      snapshot={{ status: 'unavailable', segments: [] }} duration={90}
      existing={[]} onApply={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('no pudo decodificar');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not invent speech when the decoder returned only silence', () => {
    const apply = vi.fn();
    render(<LocalVadAssistant
      snapshot={{ status: 'ready', segments: [] }} duration={30}
      existing={[]} onApply={apply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar actividad local' }));
    expect(screen.getByRole('status').textContent).toContain('No hay cortes adicionales');
    expect(screen.queryByText(/Añadir \d+ cortes revisables/)).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
});
