import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import WhisperWasmPanel from './WhisperWasmPanel';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), startCapture: vi.fn(), prepareChunks: vi.fn(),
  stopCapture: vi.fn(), closeModel: vi.fn(), transcribe: vi.fn(),
}));

vi.mock('@/modules/live-engine/core/whisper-tiny-client', () => ({
  loadLocalWhisperTiny: mocks.load,
}));
vi.mock('@/modules/live-engine/core/local-pcm-capture', () => ({
  startLocalPcmCapture: mocks.startCapture,
}));
vi.mock('@/modules/live-engine/core/local-asr-worker-client', () => ({
  prepareCapturedLocalAsrChunksInWorker: mocks.prepareChunks,
}));

function mount(blocked = false) {
  const onMicrophoneActive = vi.fn();
  const onFinalTranscript = vi.fn();
  render(
    <WhisperWasmPanel
      language="es" microphoneBusy={blocked}
      onMicrophoneActive={onMicrophoneActive}
      onFinalTranscript={onFinalTranscript}
    />,
  );
  return { onMicrophoneActive, onFinalTranscript };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('voluntary, local-only Whisper interface', () => {
  it('never requests model or microphone before an explicit opted-in click', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('AudioWorkletNode', class {});
    vi.stubGlobal('WebAssembly', {});
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
    mount();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.startCapture).not.toHaveBeenCalled();

    const button = screen.getByRole('button', { name: 'Descargar y preparar Whisper local' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    mocks.load.mockResolvedValue({ close: mocks.closeModel, transcribe: mocks.transcribe });
    fireEvent.click(button);
    await screen.findByText('Modelo preparado en este equipo.');
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.startCapture).not.toHaveBeenCalled();
  });

  it('blocks microphone recording when native recognition or probe is active', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('AudioWorkletNode', class {});
    vi.stubGlobal('WebAssembly', {});
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
    mocks.load.mockResolvedValue({ close: mocks.closeModel, transcribe: mocks.transcribe });
    mount(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar y preparar Whisper local' }));
    await screen.findByText('Modelo preparado en este equipo.');

    const start = screen.getByRole('button', { name: 'Iniciar transcripción Whisper' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    expect(mocks.startCapture).not.toHaveBeenCalled();
  });

  it('cancels in-flight model downloads and closes late model responses', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('AudioWorkletNode', class {});
    vi.stubGlobal('WebAssembly', {});
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
    let resolve!: (value: { close: typeof mocks.closeModel; transcribe: typeof mocks.transcribe }) => void;
    mocks.load.mockReturnValue(new Promise(done => { resolve = done; }));
    mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar y preparar Whisper local' }));
    expect(screen.getByText(/Preparando modelo local/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar descarga' }));
    await act(async () => { resolve({ close: mocks.closeModel, transcribe: mocks.transcribe }); });
    expect(mocks.closeModel).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Modelo no cargado.')).toBeTruthy();
  });
  it('does not publish overlapping model output until a human reviews the window', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('AudioWorkletNode', class {});
    vi.stubGlobal('WebAssembly', {});
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });

    mocks.load.mockResolvedValue({ close: mocks.closeModel, transcribe: mocks.transcribe });
    mocks.transcribe.mockResolvedValue('Administer five milligrams');
    mocks.startCapture.mockResolvedValue({
      stop: mocks.stopCapture,
      sampleRate: 48_000,
      frames: { async *[Symbol.asyncIterator]() {} },
    });
    mocks.prepareChunks.mockImplementation(async function* () {
      yield {
        samples: new Float32Array(16_000).fill(0.3),
        startMs: 0,
        endMs: 10_000,
        kind: 'tail',
        sampleRate: 16_000,
        startSample: 0,
        endSample: 16_000,
      };
    });

    const { onFinalTranscript } = mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar y preparar Whisper local' }));
    await screen.findByText('Modelo preparado en este equipo.');
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar transcripción Whisper' }));

    const review = await screen.findByRole('textbox', { name: 'Revisar y corregir texto de esta ventana' });
    expect((review as HTMLTextAreaElement).value).toBe('Administer five milligrams');
    expect(onFinalTranscript).not.toHaveBeenCalled();
    fireEvent.change(review, { target: { value: 'Administrar cinco miligramos' } });
    const confirm = screen.getByRole('button', { name: 'Añadir texto revisado a la transcripción confirmada' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onFinalTranscript).toHaveBeenCalledTimes(1);
    expect(onFinalTranscript).toHaveBeenCalledWith('Administrar cinco miligramos');
    expect(mocks.closeModel).toHaveBeenCalledTimes(1);
  });

  it('terminates an actively transcribing model immediately when audio is stopped', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('AudioWorkletNode', class {});
    vi.stubGlobal('WebAssembly', {});
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });

    let reject!: (reason: Error) => void;
    mocks.transcribe.mockImplementation(() => new Promise<string>((_resolve, onReject) => { reject = onReject; }));
    mocks.closeModel.mockImplementation(() => { reject?.(new Error('LOCAL_WHISPER_CANCELLED')); });
    mocks.load.mockResolvedValue({ close: mocks.closeModel, transcribe: mocks.transcribe });
    mocks.startCapture.mockResolvedValue({
      stop: mocks.stopCapture,
      sampleRate: 48_000,
      frames: { async *[Symbol.asyncIterator]() {} },
    });
    mocks.prepareChunks.mockImplementation(async function* () {
      yield {
        samples: new Float32Array(16_000).fill(0.2),
        startMs: 0,
        endMs: 10_000,
        kind: 'tail',
        sampleRate: 16_000,
        startSample: 0,
        endSample: 16_000,
      };
    });

    const { onMicrophoneActive, onFinalTranscript } = mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar y preparar Whisper local' }));
    await screen.findByText('Modelo preparado en este equipo.');
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar transcripción Whisper' }));
    await act(async () => {
      for (let i = 0; i < 12 && !mocks.transcribe.mock.calls.length; i += 1) await Promise.resolve();
    });
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Detener audio y liberar modelo' }));
    expect(mocks.stopCapture).toHaveBeenCalledTimes(1);
    expect(mocks.closeModel).toHaveBeenCalledTimes(1);
    expect(onMicrophoneActive).toHaveBeenLastCalledWith(false);
    expect(onFinalTranscript).not.toHaveBeenCalled();
    expect(screen.getByText('Modelo no cargado.')).toBeTruthy();
  });

});
