// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));

describe('Audio Studio clip review player', () => {
  let pause: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: (() => { let n = 0; return () => `clip-${++n}`; })() });
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:studio-test'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects MP3 metadata beyond two hours before enabling editing', () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'source.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 7200.1 });
    fireEvent.loadedMetadata(player);
    expect(screen.getByText(/El MP3 supera las 2 horas admitidas/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Añadir intervención/i })).toBeNull();

    Object.defineProperty(player, 'duration', { configurable: true, value: 7200 });
    fireEvent.loadedMetadata(player);
    expect(screen.getByRole('button', { name: /Añadir intervención/i })).toBeTruthy();
  });

  it('still downloads a ZIP when the audio and edits remain unchanged', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'unchanged.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 90 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve({ ok: true, blob: async () => new Blob(['valid-zip']) } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));

    let finishFetch!: (response: Response) => void;
    const responsePending = new Promise<Response>(resolve => { finishFetch = resolve; });
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => responsePending);
    vi.stubGlobal('fetch', fetchMock);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

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
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));

    let finishBlob!: (value: Blob) => void;
    const pendingBlob = new Promise<Blob>(resolve => { finishBlob = resolve; });
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve({ ok: true, blob: () => pendingBlob } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
    expect(screen.getAllByRole('button', { name: /Escuchar fragmento/i })).toHaveLength(2);

    pause.mockClear(); // Loading a new file deliberately stops the previous preview.
    const buttons = screen.getAllByRole('button', { name: /Escuchar fragmento/i });
    fireEvent.click(buttons[0]);
    expect(screen.getByRole('button', { name: 'Detener fragmento' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Escuchar fragmento/i }));

    // The browser's delayed onPause event used to clear the new clip's boundary.
    expect(pause).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Detener fragmento' })).toBeTruthy();

    player.currentTime = 60.1;
    fireEvent.timeUpdate(player);
    expect(screen.queryByRole('button', { name: 'Detener fragmento' })).toBeNull();
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
