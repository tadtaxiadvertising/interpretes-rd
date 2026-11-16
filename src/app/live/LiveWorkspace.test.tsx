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
  vi.unstubAllGlobals();
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

class OnDeviceRecognizerForTest {
  static available = vi.fn(async () => 'available' as const);
  static install = vi.fn(async () => true);
  processLocally = false;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult = null;
  onerror = null;
  onend = null;
  start = vi.fn();
  abort = vi.fn();
}

describe('Live audio capture exclusivity', () => {
  it('blocks local speech while the microphone probe holds a stream', async () => {
    const mic = mockMicrophone();
    vi.stubGlobal('SpeechRecognition', OnDeviceRecognizerForTest);
    render(<LiveWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: 'Probar micrófono' }));
    await act(async () => { mic.pending.resolve(mic.stream); await mic.pending.promise; });

    fireEvent.click(screen.getByRole('button', { name: 'Comprobar idioma local' }));
    await screen.findByText('Paquete local disponible.');

    const start = screen.getByRole('button', { name: 'Iniciar transcripción local' });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(start);
    expect(screen.queryByText('Escuchando y transcribiendo en este dispositivo.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Detener micrófono' }));
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect((start as HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks microphone probing while local speech recognition is active', async () => {
    vi.stubGlobal('SpeechRecognition', OnDeviceRecognizerForTest);
    render(<LiveWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: 'Comprobar idioma local' }));
    await screen.findByText('Paquete local disponible.');
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar transcripción local' }));

    expect(screen.getByText('Escuchando y transcribiendo en este dispositivo.')).toBeTruthy();
    const probe = screen.getByRole('button', { name: 'Detén la transcripción antes de probar el micrófono' });
    expect((probe as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Detener transcripción' }));
    expect((screen.getByRole('button', { name: 'Probar micrófono' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
