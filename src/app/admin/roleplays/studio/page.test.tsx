// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RoleplayStudioPage from './page';
import { createLongMediaDraft } from '@/lib/roleplay-studio/long-media';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));

describe('Audio Studio clip review player', () => {
  let pause: ReturnType<typeof vi.spyOn>;
  const selectServerZip = () => fireEvent.click(screen.getByRole('radio', {
    name: /Servidor \(opcional\): el MP3 se subirá/i,
  }));

  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: (() => { let n = 0; return () => `clip-${++n}`; })() });
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:studio-test'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    // Changing a source with unsaved turns now requires explicit acceptance.
    // These export/reset cases intentionally approve it; refusal is tested separately.
    // Replacing a source with edits requires an explicit confirmation in the
    // browser; jsdom does not implement confirm(). These particular tests
    // exercise the accepted-replacement path rather than cancellation.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('warns before unloading an edited project but not an empty editor', () => {
    const { container } = render(<RoleplayStudioPage />);
    const initialEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(initialEvent);
    expect(initialEvent.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'unsaved.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 120 });
    fireEvent.loadedMetadata(player);
    const noEditsEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(noEditsEvent);
    expect(noEditsEvent.defaultPrevented).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });

  it('lets an administrator reject each internal navigation without losing edits', () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'keep.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 120 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    vi.mocked(window.confirm).mockReturnValue(false);

    for (const linkName of ['Volver a roleplays', 'Configurar Audio Studio', 'Importar y asignar']) {
      expect(fireEvent.click(screen.getByRole('link', { name: linkName }))).toBe(false);
    }
    expect(window.confirm).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.getByLabelText('Título')).toBeTruthy();
  });

  it('saves a local JSON via Ctrl+S only with editor work and never uploads the source', async () => {
    const audio = new File(['ID3'], 'quick-save.mp3', { type: 'audio/mpeg' });
    vi.spyOn(audio, 'slice').mockImplementation(() => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as Blob);
    vi.stubGlobal('crypto', {
      randomUUID: () => 'quick-save-turn',
      subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) },
    });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container } = render(<RoleplayStudioPage />);

    const cleanShortcut = new KeyboardEvent('keydown', {
      key: 's', ctrlKey: true, bubbles: true, cancelable: true,
    });
    window.dispatchEvent(cleanShortcut);
    expect(cleanShortcut.defaultPrevented).toBe(false);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [audio] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    expect(screen.getByText(/Atajo: Ctrl\/⌘\+S/)).toBeTruthy();

    const shortcut = new KeyboardEvent('keydown', {
      key: 's', ctrlKey: true, bubbles: true, cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(shortcut);
      await Promise.resolve();
    });
    expect(shortcut.defaultPrevented).toBe(true);
    expect(download).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByText(/Plan de cortes local descargado/i)).toBeTruthy();
  });

  it('does not duplicate a slow local save when Ctrl+S is pressed again', async () => {
    const audio = new File(['ID3'], 'slow-save.mp3', { type: 'audio/mpeg' });
    vi.spyOn(audio, 'slice').mockImplementation(() => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as Blob);
    let finishDigest!: (value: ArrayBuffer) => void;
    const digest = vi.fn(() => new Promise<ArrayBuffer>(resolve => { finishDigest = resolve; }));
    vi.stubGlobal('crypto', { randomUUID: () => 'slow-save-turn', subtle: { digest } });
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [audio] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));

    await act(async () => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
      fireEvent.keyDown(window, { key: 's', metaKey: true });
      await Promise.resolve();
    });
    expect(digest).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();

    await act(async () => {
      finishDigest(new Uint8Array(32).buffer);
      await Promise.resolve();
    });
    expect(download).toHaveBeenCalledOnce();
  });

  it('restores a dropped local JSON only after verifying the selected recording', async () => {
    const source = new File(['ID3'], 'source.mp3', { type: 'audio/mpeg' });
    vi.spyOn(source, 'slice').mockImplementation(() => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as Blob);
    vi.stubGlobal('crypto', {
      randomUUID: () => 'recovered-turn',
      subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) },
    });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [source] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    const saved = createLongMediaDraft(source.size, '00'.repeat(32), [{
      title: 'Médico · 1', start: 12, end: 20, scriptPrompt: '',
      responseLimit: 120, speakerRole: 'doctor', language: 'en',
    }], 90);
    const project = new File([JSON.stringify(saved)], 'studio-project.json', { type: 'application/json' });
    Object.defineProperty(project, 'text', { value: async () => JSON.stringify(saved) });
    const dropTarget = screen.getByRole('group', { name: 'Zona para recuperar proyecto JSON' });
    await act(async () => {
      fireEvent.drop(dropTarget, { dataTransfer: { files: [project] } });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText(/Proyecto vinculado por tamaño, duración y huella parcial, restaurado/)).toBeTruthy();
    });
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect((screen.getByLabelText('Perfil del hablante') as HTMLSelectElement).value).toBe('doctor');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects invalid or multiple dropped files without replacing existing turns', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'source.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    const dropTarget = screen.getByRole('group', { name: 'Zona para recuperar proyecto JSON' });
    fireEvent.drop(dropTarget, { dataTransfer: { files: [
      new File(['{}'], 'one.json'), new File(['{}'], 'two.json'),
    ] } });
    expect(screen.getByRole('alert').textContent).toContain('un único archivo de proyecto JSON');
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();

    await act(async () => {
      fireEvent.drop(dropTarget, { dataTransfer: { files: [new File(['not-a-project'], 'ignored.txt')] } });
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toContain('Selecciona un proyecto JSON');
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
  });

  it('explains HappyScribe Markdown is a transcript, not an Audio Studio JSON project, without losing edits', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    const markdown = new File(['# Transcript with private dialogue'], 'happyscribe.md', {
      type: 'text/markdown',
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [markdown] },
      });
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toContain('no un archivo SRT/VTT');
    expect(screen.getByText('Intervenciones (1/25)')).toBeTruthy();

    await act(async () => {
      fireEvent.drop(screen.getByRole('group', { name: 'Zona para recuperar proyecto JSON' }), {
        dataTransfer: { files: [markdown] },
      });
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toContain('no es un proyecto JSON');
    expect(screen.getByText('Intervenciones (1/25)')).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByText(/Transcript with private dialogue/)).toBeNull();
  });

  it('does not misrepresent a pending SRT selection as a recoverable empty project', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'dialogue.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    const lines = Array.from({ length: 26 }, (_, i) =>
      `${i + 1}\n00:00:${String(i * 2).padStart(2, '0')},000 --> 00:00:${String(i * 2 + 1).padStart(2, '0')},000\nDoctor: Example ${i}`).join('\n\n');
    const subtitles = new File(['srt'], 'review.srt', { type: 'text/plain' });
    Object.defineProperty(subtitles, 'text', { value: async () => lines });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [subtitles] },
      });
      await Promise.resolve();
    });
    expect(screen.getByText(/26 intervenciones disponibles/)).toBeTruthy();
    expect(screen.getByLabelText('Contenido no incluido en el proyecto JSON')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar proyecto JSON' }));
    expect(screen.getByRole('alert').textContent).toContain('Todavía no hay cortes aplicados para guardar');
    expect(download).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('warns that downloaded metadata does not include imported transcript references', async () => {
    const audio = new File(['ID3'], 'dialogue.mp3', { type: 'audio/mpeg' });
    vi.spyOn(audio, 'slice').mockImplementation(() => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as Blob);
    vi.stubGlobal('crypto', {
      randomUUID: () => 'restorable-turn',
      subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) },
    });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [audio] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    const subtitles = new File(['srt'], 'privacy.srt', { type: 'text/plain' });
    Object.defineProperty(subtitles, 'text', { value: async () =>
      '1\n00:00:01,000 --> 00:00:04,000\nDoctor: Sensitive reference', configurable: true });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [subtitles] },
      });
      await Promise.resolve();
    });
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.getByLabelText('Contenido no incluido en el proyecto JSON')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar proyecto JSON' }));
      await Promise.resolve();
    });
    expect(download).toHaveBeenCalledOnce();
    expect(screen.getByText(/Plan de cortes local descargado.*Atención: el JSON no guarda referencias privadas de transcripción/)).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('opens MP3 above two hours in local mode and rejects media above twelve hours', () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'source.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 7200.1 });
    fireEvent.loadedMetadata(player);
    expect(screen.getByText(/Preparación local:/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Añadir fragmento/i })).toBeTruthy();

    Object.defineProperty(player, 'duration', { configurable: true, value: 43200.1 });
    fireEvent.loadedMetadata(player);
    expect(screen.getByText(/supera las 12 horas admitidas/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Añadir fragmento/i })).toBeNull();

    Object.defineProperty(player, 'duration', { configurable: true, value: 7200 });
    fireEvent.loadedMetadata(player);
    expect(screen.getByRole('button', { name: /Añadir fragmento/i })).toBeTruthy();
  });

  it('previews a local VAD region using the existing audio player and stops at its end', async () => {
    const source = new File(['ID3'], 'local-preview.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(source, 'arrayBuffer', {
      configurable: true, value: vi.fn(async () => new ArrayBuffer(16)),
    });
    const samples = new Float32Array(16000 * 4);
    for (let i = 16000; i < 16000 * 2.7; i++) {
      samples[i] = Math.sin(i / 8) * 0.2;
    }
    const decode = vi.fn(async () => ({
      duration: 4,
      sampleRate: 16000,
      numberOfChannels: 1,
      getChannelData: () => samples,
    }));
    const makeContext = vi.fn(function FakeAudioContext() {
      // The real AudioContext exposes a sample rate before decodeAudioData.
      // Omitting it incorrectly drives the PCM safety gate into limited mode.
      return { sampleRate: 16000, decodeAudioData: decode, close: vi.fn(async () => {}) };
    });
    vi.stubGlobal('AudioContext', makeContext);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [source] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 4 });
    fireEvent.loadedMetadata(player);

    // Audio decoding and React's effect that resets the review state are
    // asynchronous. Readiness of the button alone is not proof that VAD
    // finished publishing a speech-region snapshot.
    await waitFor(() => {
      expect(screen.getByText(/1 regiones con actividad detectadas/)).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Revisar actividad local' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar actividad local' }));
    // Wait for review state to settle before checking bounded playback. This
    // verifies the actual user control instead of assuming synchronous effects.
    const listen = await screen.findByRole('button', { name: 'Escuchar región 1' });
    fireEvent.click(listen);
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.currentTime).toBeGreaterThan(0);
    expect(player.currentTime).toBeLessThan(2);

    player.currentTime = 3.5;
    fireEvent.timeUpdate(player);
    expect(pause).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    expect(decode).toHaveBeenCalledOnce();
  });

  it('prepares a short MP3 locally by default without posting media to the server', async () => {
    const source = new File(['ID3'], 'private-short.mp3', { type: 'audio/mpeg' });
    vi.spyOn(source, 'slice').mockImplementation(() => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as Blob);
    vi.stubGlobal('crypto', {
      randomUUID: () => 'private-segment',
      subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) },
    });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [source] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    expect((screen.getByRole('radio', { name: /Local \(predeterminado\)/i }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /Servidor \(opcional\)/i }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Actividad de voz en este equipo/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Detectar pausas en servidor/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Descargar plan local de cortes/i }));
      await Promise.resolve();
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByText(/Plan de cortes local descargado/i)).toBeTruthy();

    selectServerZip();
    expect((screen.getByRole('radio', { name: /Servidor \(opcional\)/i }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'next-source.mp3', { type: 'audio/mpeg' })] },
    });
    const replacementPlayer = container.querySelector('audio')!;
    Object.defineProperty(replacementPlayer, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(replacementPlayer);
    expect((screen.getByRole('radio', { name: /Local \(predeterminado\)/i }) as HTMLInputElement).checked).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('still downloads a ZIP when the audio and edits remain unchanged', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'unchanged.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve({ ok: true, blob: async () => new Blob(['valid-zip']) } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
      selectServerZip();
      fireEvent.click(screen.getByRole('button', { name: /Exportar MP3/i }));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Paquete generado/)).toBeTruthy();
  });

  it('aborts an old ZIP export when the administrator selects a different MP3', async () => {
    const { container } = render(<RoleplayStudioPage />);
    const input = screen.getByLabelText(/Grabación original MP3/i);
    const choose = (name: string) => {
      fireEvent.change(input, {
        target: { files: [new File(['ID3'], name, { type: 'audio/mpeg' })] },
      });
      const player = container.querySelector('audio')!;
      Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
      fireEvent.loadedMetadata(player);
    };
    choose('first.mp3');
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));

    let finishFetch!: (response: Response) => void;
    const responsePending = new Promise<Response>(resolve => { finishFetch = resolve; });
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => responsePending);
    vi.stubGlobal('fetch', fetchMock);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    selectServerZip();
      fireEvent.click(screen.getByRole('button', { name: /Exportar MP3/i }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    choose('second.mp3');
    expect(signal.aborted).toBe(true);

    // A proxy can still complete after the browser aborts. Its stale result
    // must never download a ZIP or mark the newer project as exported.
    await act(async () => {
      finishFetch({ ok: true, blob: async () => new Blob(['old-zip']) } as Response);
      await responsePending;
    });
    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByText(/Paquete generado/)).toBeNull();
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
  });

  it('does not download a completed export when segment edits invalidate its snapshot', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'source.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));

    let finishBlob!: (value: Blob) => void;
    const pendingBlob = new Promise<Blob>(resolve => { finishBlob = resolve; });
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve({ ok: true, blob: () => pendingBlob } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
      selectServerZip();
      fireEvent.click(screen.getByRole('button', { name: /Exportar MP3/i }));
      await Promise.resolve();
    });
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Corte actualizado' } });
    expect(signal.aborted).toBe(true);

    await act(async () => {
      finishBlob(new Blob(['outdated']));
      await pendingBlob;
    });
    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByText(/Paquete generado/)).toBeNull();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Corte actualizado');
  });

  it('switches between cuts without pausing away the new preview marker', () => {
    const { container } = render(<RoleplayStudioPage />);
    const input = screen.getByLabelText(/Grabación original MP3/i);
    fireEvent.change(input, {
      target: { files: [new File(['ID3'], 'source.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);

    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    expect(screen.getAllByRole('button', { name: /Escuchar fragmento/i })).toHaveLength(2);

    pause.mockClear(); // Loading a new file deliberately stops the previous preview.
    const buttons = screen.getAllByRole('button', { name: /Escuchar fragmento/i });
    fireEvent.click(buttons[0]);
    expect(screen.getByRole('button', { name: 'Detener fragmento de intervención 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Escuchar fragmento de intervención 2' }));

    // The browser's delayed onPause event used to clear the new clip's boundary.
    expect(pause).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Detener fragmento de intervención 2' })).toBeTruthy();

    player.currentTime = 60.1;
    fireEvent.timeUpdate(player);
    expect(screen.queryByRole('button', { name: 'Detener fragmento de intervención 2' })).toBeNull();
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('can download the same long-source JSON plan twice without sending the video to a server', async () => {
    const { container } = render(<RoleplayStudioPage />);
    const source = new File(['ID3'], 'long-video.mp4', { type: 'video/mp4' });
    // jsdom File slices are replaced with a bounded local sample; the test
    // verifies the control flow, not the browser's native file decoder.
    vi.spyOn(source, 'slice').mockImplementation(() => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as unknown as Blob);
    vi.stubGlobal('crypto', {
      randomUUID: () => 'long-cut-1',
      subtle: {
        digest: vi.fn(async () => new Uint8Array(32).buffer),
      },
    });
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [source] },
    });
    const player = container.querySelector('video')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 7201 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));

    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    for (let i = 0; i < 2; i++) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Descargar plan local/i }));
        await Promise.resolve();
      });
    }
    expect(downloadClick).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });


  it('requires explicit per-file consent before the optional server uploads MP3 audio', async () => {
    const request = vi.fn(async (_url: string, _options?: RequestInit) => ({
      ok: true,
      json: async () => ({
        durationSeconds: 90,
        silences: [{ start: 2, end: 3 }],
      }),
    }));
    vi.stubGlobal('fetch', request);
    const { container } = render(<RoleplayStudioPage />);
    const sourceInput = screen.getByLabelText(/Grabación original MP3/i);
    fireEvent.change(sourceInput, {
      target: { files: [new File(['ID3'], 'first.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);

    const consent = screen.getByRole('checkbox', {
      name: 'Autorizo subir este MP3 al servidor para detectar pausas',
    }) as HTMLInputElement;
    const serverButton = screen.getByRole('button', { name: 'Detectar pausas en servidor' }) as HTMLButtonElement;
    expect(consent.checked).toBe(false);
    expect(serverButton.disabled).toBe(true);
    expect(request).not.toHaveBeenCalled();

    fireEvent.click(consent);
    expect(serverButton.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(serverButton);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/api/admin/roleplays/studio/silences');
    expect((request.mock.calls[0][1] as RequestInit).body).toBeInstanceOf(FormData);

    fireEvent.change(sourceInput, {
      target: { files: [new File(['ID3'], 'second.mp3', { type: 'audio/mpeg' })] },
    });
    expect(consent.checked).toBe(false);
    expect(serverButton.disabled).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps consent attached to the original recording when replacement is declined', () => {
    const { container } = render(<RoleplayStudioPage />);
    const input = screen.getByLabelText(/Grabación original MP3/i);
    fireEvent.change(input, {
      target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    const originalUrl = player.getAttribute('src');
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    const consent = screen.getByRole('checkbox', {
      name: 'Autorizo subir este MP3 al servidor para detectar pausas',
    }) as HTMLInputElement;
    fireEvent.click(consent);
    expect(consent.checked).toBe(true);

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.change(input, {
      target: { files: [new File(['ID3'], 'replacement.mp3', { type: 'audio/mpeg' })] },
    });

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(consent.checked).toBe(true);
    expect((container.querySelector('audio') as HTMLAudioElement).getAttribute('src'))
      .toBe(originalUrl);
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revoking server consent aborts the in-flight upload request', async () => {
    let capturedSignal: AbortSignal | undefined;
    const request = vi.fn((_url: string, options: RequestInit) => {
      capturedSignal = options.signal as AbortSignal;
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', request);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'revoked.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    const consent = screen.getByRole('checkbox', {
      name: 'Autorizo subir este MP3 al servidor para detectar pausas',
    });
    fireEvent.click(consent);
    fireEvent.click(screen.getByRole('button', { name: 'Detectar pausas en servidor' }));
    expect(capturedSignal?.aborted).toBe(false);
    fireEvent.click(consent);
    expect(capturedSignal?.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('discards a delayed HappyScribe transcript when a different recording is selected', async () => {
    const itemId = 'a'.repeat(32);
    let finishImport!: (response: Response) => void;
    const pendingImport = new Promise<Response>(resolve => { finishImport = resolve; });
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? pendingImport
        : Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: [{ id: itemId, name: 'Consulta', state: 'done', language: 'es',
                durationSeconds: 90, createdAt: null, folder: null }],
            }),
          } as Response));
    vi.stubGlobal('fetch', fetcher);

    const { container } = render(<RoleplayStudioPage />);
    const sourceInput = screen.getByLabelText(/Grabación original MP3/i);
    const choose = (name: string) => {
      fireEvent.change(sourceInput, {
        target: { files: [new File(['ID3'], name, { type: 'audio/mpeg' })] },
      });
      const player = container.querySelector('audio')!;
      Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
      fireEvent.loadedMetadata(player);
    };
    choose('original.mp3');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Importar transcripción' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Importar audio original' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Importar transcripción' }));
    expect(fetcher).toHaveBeenCalledTimes(2);
    choose('different.mp3');

    await act(async () => {
      finishImport({
        ok: true,
        json: async () => ({
          success: true, data: { content:
            '1\n00:00:00,000 --> 00:00:10,000\nDoctor: Obsolete transcript' },
        }),
      } as Response);
      await pendingImport;
      await Promise.resolve();
    });
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(screen.queryByText(/Obsolete transcript/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aplicar selección al editor' })).toBeNull();
  });

  it('cancels an unfinished HappyScribe MP3 transfer when a different recording is chosen', async () => {
    const itemId = 'a'.repeat(32);
    let pendingSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        pendingSignal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          pendingSignal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true, mediaImportEnabled: true,
          data: [{ id: itemId, name: 'Original.mp3', state: 'automatic_done',
            language: 'es', durationSeconds: 90, createdAt: null, folder: null }],
        }),
      } as Response);
    });
    vi.stubGlobal('fetch', fetcher);

    const { container } = render(<RoleplayStudioPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));
    expect(pendingSignal?.aborted).toBe(false);
    expect(screen.getByRole('button', { name: 'Cancelar descarga' })).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
        target: { files: [new File(['ID3'], 'replacement.mp3', { type: 'audio/mpeg' })] },
      });
      await Promise.resolve();
    });

    expect(pendingSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Audio original importado desde HappyScribe/)).toBeNull();
    expect(container.querySelector('audio')?.getAttribute('src')).toMatch(/^blob:/);
    expect(screen.queryByRole('button', { name: 'Cancelar descarga' })).toBeNull();
  });

  it('does not spend provider bandwidth if unsaved edits are not approved for MP3 replacement', async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.reject(new Error('Unexpected MP3 transfer'));
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true, mediaImportEnabled: true,
          data: [{ id: 'a'.repeat(32), name: 'Remote.mp3', state: 'automatic_done',
            language: 'en', durationSeconds: 90, createdAt: null, folder: null }],
        }),
      } as Response);
    });
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'local.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(screen.getByText(/Intervenciones \(1\/25\)/i)).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Cancelar descarga' })).toBeNull();
  });

  it('asks once when preapproved edits stay unchanged during the MP3 transfer', async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200 }));
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true, mediaImportEnabled: true,
          data: [{ id: 'a'.repeat(32), name: 'Remote.mp3', state: 'automatic_done',
            language: 'en', durationSeconds: 90, createdAt: null, folder: null }],
        }),
      } as Response);
    });
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'local.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));
      await Promise.resolve();
    });

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    // Loading the new source resets its duration; the intervention panel is
    // rendered again only after the audio element reads metadata.
    expect(screen.getByText(/Audio original importado desde HappyScribe/)).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('discards a stale MP3 if new interventions appear while downloading', async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise<Response>(resolve => { complete = resolve; });
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true, mediaImportEnabled: true,
          data: [{ id: 'a'.repeat(32), name: 'Remote.mp3', state: 'automatic_done',
            language: 'en', durationSeconds: 90, createdAt: null, folder: null }],
        }),
      } as Response);
    });
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'local.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));
    expect(window.confirm).toHaveBeenCalledOnce();

    // A new intervention invalidates the original source revision. Do not
    // attach the obsolete MP3 or ask for another confirmation unnecessarily.
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    vi.mocked(window.confirm).mockReturnValue(false);
    await act(async () => {
      complete(new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200 }));
      await Promise.resolve();
    });

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByText(/Intervenciones \(2\/25\)/i)).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Audio original importado desde HappyScribe/)).toBeNull();
  });

  it('lets an administrator cancel a HappyScribe transfer without replacing the recording', async () => {
    const itemId = 'a'.repeat(32);
    let pendingSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        pendingSignal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          pendingSignal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true, mediaImportEnabled: true,
          data: [{ id: itemId, name: 'Practice.mp3', state: 'automatic_done',
            language: 'en', durationSeconds: 90, createdAt: null, folder: null }],
        }),
      } as Response);
    }));

    render(<RoleplayStudioPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar descarga' }));
      await Promise.resolve();
    });
    expect(pendingSignal?.aborted).toBe(true);
    expect(screen.getByText(/Descarga de audio cancelada/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Importar audio original' })).toBeTruthy();
  });

  it('ignores a successful media response that arrives after cancellation', async () => {
    let complete!: (response: Response) => void;
    let requestSignal: AbortSignal | undefined;
    const blob = vi.fn(async () => new Blob(['ID3'], { type: 'audio/mpeg' }));
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        requestSignal = init.signal as AbortSignal;
        return new Promise<Response>(resolve => { complete = resolve; });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true, mediaImportEnabled: true,
          data: [{ id: 'a'.repeat(32), name: 'Original.mp3', state: 'automatic_done',
            language: 'es', durationSeconds: 90, createdAt: null, folder: null }],
        }),
      } as Response);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<RoleplayStudioPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar descarga' }));
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => {
      complete({ ok: true, blob } as unknown as Response);
      await Promise.resolve();
    });

    expect(blob).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByText(/Audio original importado desde HappyScribe/)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not attach a late MP3 body after the download was cancelled', async () => {
    let completeBody!: (blob: Blob) => void;
    let requestSignal: AbortSignal | undefined;
    const blob = vi.fn(() => new Promise<Blob>(resolve => { completeBody = resolve; }));
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        requestSignal = init.signal as AbortSignal;
        return Promise.resolve({ ok: true, blob } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true, mediaImportEnabled: true,
          data: [{ id: 'a'.repeat(32), name: 'Slow.mp3', state: 'automatic_done',
            language: 'es', durationSeconds: 90, createdAt: null, folder: null }],
        }),
      } as Response);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<RoleplayStudioPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));
      await Promise.resolve();
    });
    expect(blob).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar descarga' }));
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => {
      completeBody(new Blob(['ID3'], { type: 'audio/mpeg' }));
      await Promise.resolve();
    });

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByText(/Audio original importado desde HappyScribe/)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts a pending media import when the selected HappyScribe transcript changes', async () => {
    let complete!: (response: Response) => void;
    let requestSignal: AbortSignal | undefined;
    const blob = vi.fn(async () => new Blob(['ID3'], { type: 'audio/mpeg' }));
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        requestSignal = init.signal as AbortSignal;
        return new Promise<Response>(resolve => { complete = resolve; });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true, mediaImportEnabled: true,
          data: [
            { id: 'a'.repeat(32), name: 'First.mp3', state: 'automatic_done',
              language: 'es', durationSeconds: 90, createdAt: null, folder: null },
            { id: 'b'.repeat(32), name: 'Second.mp3', state: 'automatic_done',
              language: 'en', durationSeconds: 60, createdAt: null, folder: null },
          ],
        }),
      } as Response);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<RoleplayStudioPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));
    fireEvent.change(screen.getByLabelText('Transcripción de HappyScribe'), {
      target: { value: 'b'.repeat(32) },
    });
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => {
      complete({ ok: true, blob } as unknown as Response);
      await Promise.resolve();
    });

    expect(blob).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByText(/Audio original importado desde HappyScribe/)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('unblocks new MP3 imports immediately when a cancelled provider request never settles', async () => {
    const posts: { signal: AbortSignal; body: string }[] = [];
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({
          signal: init.signal as AbortSignal,
          body: String(init.body),
        });
        // Simulate a transport that ignores abort, without keeping the UI busy.
        return new Promise<Response>(() => {});
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true, mediaImportEnabled: true,
          data: [
            { id: 'a'.repeat(32), name: 'First.mp3', state: 'automatic_done',
              language: 'es', durationSeconds: 90, createdAt: null, folder: null },
            { id: 'b'.repeat(32), name: 'Second.mp3', state: 'automatic_done',
              language: 'en', durationSeconds: 90, createdAt: null, folder: null },
          ],
        }),
      } as Response);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<RoleplayStudioPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));
    expect(posts).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar descarga' }));
    expect(posts[0].signal.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancelar descarga' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Importar audio original' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));
    expect(posts).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Transcripción de HappyScribe'), {
      target: { value: 'b'.repeat(32) },
    });
    expect(posts[1].signal.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancelar descarga' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Importar audio original' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));
    expect(posts).toHaveLength(3);
    expect(JSON.parse(posts[2].body)).toEqual({ id: 'b'.repeat(32) });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar descarga' }));
  });

  it('starts only one MP3 export even for repeated clicks before state updates', async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise<Response>(() => {});
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true, mediaImportEnabled: true,
          data: [{ id: 'a'.repeat(32), name: 'Practice.mp3', state: 'automatic_done',
            language: 'en-US', durationSeconds: 90, createdAt: null, folder: null }],
        }),
      } as Response);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<RoleplayStudioPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });

    act(() => {
      const button = screen.getByRole('button', { name: 'Importar audio original' });
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cancelar descarga' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar descarga' }));
    expect(screen.queryByRole('button', { name: 'Cancelar descarga' })).toBeNull();
  });

  it('imports the original HappyScribe MP3 directly into the Audio Studio source', async () => {
    const itemId = 'a'.repeat(32);
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00]), {
          status: 200, headers: { 'Content-Type': 'audio/mpeg' },
        });
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: [{ id: itemId, name: 'Practice recording.mp3', state: 'automatic_done',
            language: 'en-US', durationSeconds: 90, createdAt: null, folder: null }],
          mediaImportEnabled: true,
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetcher);

    const { container } = render(<RoleplayStudioPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Importar audio original' }));
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe('/api/admin/happyscribe/media');
    expect(screen.getByText(/Audio original importado desde HappyScribe/)).toBeTruthy();
    const player = container.querySelector('audio');
    expect(player?.getAttribute('src')).toMatch(/^blob:/);
  });

});
