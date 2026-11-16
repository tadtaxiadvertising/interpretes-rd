import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import LiveWorkspace from './LiveWorkspace';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function mockMicrophone() {
  const pending = deferred<MediaStream>();
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const getUserMedia = vi.fn(() => pending.promise);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  return { pending, stream, stop, getUserMedia };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Live microphone permission lifecycle', () => {
  it('stops a stream granted after the user cancels the request', async () => {
    const mic = mockMicrophone();
    render(<LiveWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Probar micrófono' }));
    expect(screen.getByRole('button', { name: 'Cancelar solicitud' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar solicitud' }));
    expect(screen.getByText('Micrófono detenido')).toBeTruthy();

    await act(async () => { mic.pending.resolve(mic.stream); await mic.pending.promise; });
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Micrófono activo en este dispositivo')).toBeNull();
  });

  it('stops a stream granted after the workspace unmounts', async () => {
    const mic = mockMicrophone();
    const view = render(<LiveWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Probar micrófono' }));
    view.unmount();

    await act(async () => { mic.pending.resolve(mic.stream); await mic.pending.promise; });
    expect(mic.stop).toHaveBeenCalledTimes(1);
  });

  it('releases the active microphone when stopped', async () => {
    const mic = mockMicrophone();
    render(<LiveWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Probar micrófono' }));

    await act(async () => { mic.pending.resolve(mic.stream); await mic.pending.promise; });
    expect(screen.getByText('Micrófono activo en este dispositivo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Detener micrófono' }));
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Micrófono detenido')).toBeTruthy();
  });
});
