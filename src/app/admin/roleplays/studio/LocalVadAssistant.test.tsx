// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LocalVadAssistant from './LocalVadAssistant';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('local VAD audio preflight', () => {
  const fakeFile = {
    size: 1024,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
  } as unknown as File;

  it('rejects an audio file over four minutes without allocating decoded audio', async () => {
    const createContext = vi.fn(() => { throw new Error('decoder must not be constructed'); });
    vi.stubGlobal('AudioContext', createContext);

    render(<LocalVadAssistant file={fakeFile} duration={301} remaining={5} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Analizar voz localmente' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('hasta 4 minutos');
    });
    expect(createContext).not.toHaveBeenCalled();
    expect(fakeFile.arrayBuffer).not.toHaveBeenCalled();
  });

  it('does not decode audio before metadata duration is available', async () => {
    const createContext = vi.fn(() => { throw new Error('decoder must not be constructed'); });
    vi.stubGlobal('AudioContext', createContext);

    render(<LocalVadAssistant file={fakeFile} duration={0} remaining={5} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Analizar voz localmente' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Espera a que se cargue la duración');
    });
    expect(createContext).not.toHaveBeenCalled();
    expect(fakeFile.arrayBuffer).not.toHaveBeenCalled();
  });
});
