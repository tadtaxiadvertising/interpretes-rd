// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import StudioWaveform from './StudioWaveform';

const originalAudioContext = Object.getOwnPropertyDescriptor(window, 'AudioContext');
function stubBrowserDecoder(factory: unknown) {
  // The component reads window.AudioContext, not bare globalThis.AudioContext.
  Object.defineProperty(window, 'AudioContext', {
    configurable: true, writable: true, value: factory,
  });
}

import type { LocalVadSnapshot } from '@/lib/roleplay-studio/local-vad';

describe('Roleplay Studio accessible waveform timeline', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalAudioContext) {
      Object.defineProperty(window, 'AudioContext', originalAudioContext);
    } else {
      Reflect.deleteProperty(window, 'AudioContext');
    }
  });

  const audio = () => new File(['ID3'], 'recording.mp3', { type: 'audio/mpeg' });

  it('supports precise keyboard or slider seeking without requiring decoded waveform data', () => {
    const seek = vi.fn();
    render(
      <StudioWaveform
        file={audio()} duration={90} currentTime={20}
        segments={[{ id: 'clip', start: 10, end: 30 }]}
        onSeek={seek}
      />,
    );

    const slider = screen.getByRole('slider', { name: /Posición del reproductor en segundos/i });
    expect(slider.getAttribute('value')).toBe('20');
    fireEvent.change(slider, { target: { value: '25.5' } });
    expect(seek).toHaveBeenCalledWith(25.5);
    expect(screen.getByText('01:30')).toBeTruthy();
  });

  it('zooms into long recordings, clips markers to the window and navigates back to the cursor', () => {
    const seek = vi.fn();
    render(<StudioWaveform
      file={audio()} duration={7200} currentTime={3600}
      segments={[
        { id: 'nearby', start: 3590, end: 3610 },
        { id: 'distant', start: 100, end: 130 },
      ]}
      onSeek={seek}
    />);
    expect(screen.getAllByTestId('studio-window-segment')).toHaveLength(2);
    fireEvent.change(screen.getByRole('combobox', { name: 'Zoom de la línea de tiempo' }), {
      target: { value: '60' },
    });
    const slider = screen.getByRole('slider', { name: /Posición del reproductor en segundos/i });
    expect(slider.getAttribute('min')).toBe('3540');
    expect(slider.getAttribute('max')).toBe('3660');
    expect(screen.getAllByTestId('studio-window-segment')).toHaveLength(1);
    fireEvent.change(slider, { target: { value: '3605' } });
    expect(seek).toHaveBeenCalledWith(3605);
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.queryAllByTestId('studio-window-segment')).toHaveLength(0);
    expect(screen.getByText(/El cursor está fuera de esta ventana/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ir al cursor' }));
    expect(screen.getAllByTestId('studio-window-segment')).toHaveLength(1);
    expect(screen.getByText('02:00:00')).toBeTruthy();
  });

  it('keeps navigation available for long recordings without allocating decoded PCM', () => {
    const file = audio();
    const seek = vi.fn();
    render(<StudioWaveform file={file} duration={1500} currentTime={0} segments={[]} onSeek={seek}/>);
    expect(screen.getByText(/Vista de tiempo simplificada/)).toBeTruthy();
    expect(screen.getByText(/proteger la memoria del navegador/i)).toBeTruthy();

    fireEvent.change(screen.getByRole('slider'), { target: { value: '900' } });
    expect(seek).toHaveBeenCalledWith(900);
  });

  it('zooms to a ten-second window for twelve-hour video without decoding the source', () => {
    const video = new File(['fictitious bytes'], 'long-source.mp4', { type: 'video/mp4' });
    const decode = vi.spyOn(video, 'arrayBuffer');
    const seek = vi.fn();
    const { container } = render(
      <StudioWaveform file={video} duration={43200} currentTime={21600}
        segments={[{ id: 'clip', start: 21599, end: 21602 }]}
        onSeek={seek} />,
    );
    const select = screen.getByRole('combobox', { name: 'Zoom de la línea de tiempo' });
    fireEvent.change(select, { target: { value: '4320' } });
    const slider = screen.getByRole('slider', { name: 'Posición del reproductor en segundos' });
    expect(slider.getAttribute('min')).toBe('21595');
    expect(slider.getAttribute('max')).toBe('21605');
    expect(slider.getAttribute('step')).toBe('0.01');
    expect(screen.getByText('06:00:00.00')).toBeTruthy();
    expect(screen.getAllByTestId('studio-window-segment')).toHaveLength(1);

    const graphic = container.querySelector('svg')!;
    vi.spyOn(graphic, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 720,
    } as DOMRect);
    fireEvent.click(graphic, { clientX: 540 });
    expect(seek).toHaveBeenCalledWith(21602.5);

    fireEvent.click(screen.getByRole('button', { name: 'Retroceder cinco segundos' }));
    expect(seek).toHaveBeenCalledWith(21595);
    fireEvent.click(screen.getByRole('button', { name: 'Avanzar cinco segundos' }));
    expect(seek).toHaveBeenCalledWith(21605);
    fireEvent.change(slider, { target: { value: '21600.25' } });
    expect(seek).toHaveBeenCalledWith(21600.25);
    expect(decode).not.toHaveBeenCalled();
  });

  it('resets the timeline when replacing a long video with a short recording', () => {
    const longVideo = new File(['video'], 'long.mp4');
    const shortAudio = new File(['ID3'], 'short.mp3');
    const seek = vi.fn();
    const { rerender } = render(<StudioWaveform
      file={longVideo} duration={43200} currentTime={21600} segments={[]} onSeek={seek}/>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Zoom de la línea de tiempo' }), {
      target: { value: '4320' },
    });
    rerender(<StudioWaveform
      file={shortAudio} duration={90} currentTime={0} segments={[]} onSeek={seek}/>);
    const zoom = screen.getByRole('combobox', { name: 'Zoom de la línea de tiempo' }) as HTMLSelectElement;
    expect(zoom.value).toBe('1');
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('90');
    expect([...zoom.options].map(option => option.value)).toEqual(['1', '4']);
  });


  it('decodes a short MP3 only once for both waveform and VAD, without network', async () => {
    const source = audio();
    const read = vi.fn(async () => new ArrayBuffer(16));
    Object.defineProperty(source, 'arrayBuffer', { configurable: true, value: read });
    const samples = new Float32Array(16000 * 3);
    for (let index = 16000; index < 16000 * 2; index++) {
      samples[index] = Math.sin(index / 8) * 0.2;
    }
    const decode = vi.fn(async () => ({
      duration: 3,
      sampleRate: 16000,
      numberOfChannels: 1,
      getChannelData: () => samples,
    }));
    const close = vi.fn(async () => {});
    const makeContext = vi.fn(() => ({ decodeAudioData: decode, close }));
    const fetcher = vi.fn();
    stubBrowserDecoder(makeContext);
    vi.stubGlobal('fetch', fetcher);
    const notify = vi.fn((_source: File, _result: LocalVadSnapshot) => {});
    const seek = vi.fn();

    const { rerender } = render(<StudioWaveform
      file={source} duration={3} currentTime={0} segments={[]}
      onSeek={seek} onLocalVadResult={notify}/>);
    await waitFor(() => {
      expect(notify.mock.calls.some(([, result]) => result.status === 'ready')).toBe(true);
    });
    const latest = notify.mock.calls.at(-1)?.[1];
    expect(latest.segments.length).toBeGreaterThan(0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(makeContext).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    rerender(<StudioWaveform
      file={source} duration={3} currentTime={2} segments={[]}
      onSeek={seek} onLocalVadResult={notify}/>);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never decodes a source above 4 minutes or 8 MiB', () => {
    const source = audio();
    const read = vi.fn();
    Object.defineProperty(source, 'arrayBuffer', { configurable: true, value: read });
    const decode = vi.fn();
    stubBrowserDecoder(decode);
    const notify = vi.fn((_source: File, _result: LocalVadSnapshot) => {});
    render(<StudioWaveform file={source} duration={300}
      currentTime={0} segments={[]} onSeek={vi.fn()} onLocalVadResult={notify}/>);
    expect(read).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(source, { status: 'limited', segments: [] });
  });

  it('ignores results of a replaced MP3 and reports browser decoder failure', async () => {
    const first = audio();
    const second = new File(['ID3'], 'replacement.mp3', { type: 'audio/mpeg' });
    let release: ((decoded: unknown) => void) | undefined;
    const oldResult = new Promise(resolve => { release = resolve; });
    Object.defineProperty(first, 'arrayBuffer', {
      configurable: true, value: vi.fn(async () => new ArrayBuffer(4)),
    });
    Object.defineProperty(second, 'arrayBuffer', {
      configurable: true, value: vi.fn(async () => new ArrayBuffer(8)),
    });
    const decode = vi.fn((bytes: ArrayBuffer) =>
      bytes.byteLength === 4 ? oldResult : Promise.reject(new Error('unsupported codec')));
    const close = vi.fn(async () => {});
    stubBrowserDecoder(vi.fn(() => ({ decodeAudioData: decode, close })));
    const notify = vi.fn((_source: File, _result: LocalVadSnapshot) => {});
    const { rerender } = render(<StudioWaveform
      file={first} duration={3} currentTime={0} segments={[]}
      onSeek={vi.fn()} onLocalVadResult={notify}/>);
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    rerender(<StudioWaveform
      file={second} duration={3} currentTime={0} segments={[]}
      onSeek={vi.fn()} onLocalVadResult={notify}/>);
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(second, { status: 'unavailable', segments: [] });
    });
    release?.({
      duration: 3, sampleRate: 16000, numberOfChannels: 1,
      getChannelData: () => new Float32Array(16000 * 3),
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(notify.mock.calls.some(([source, result]) =>
      source === first && result.status === 'ready')).toBe(false);
  });

});
