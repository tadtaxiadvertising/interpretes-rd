// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));

describe('Audio Studio subtitle import lifecycle', () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'test-cue-' + ++id });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test-mp3') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts at most one provider SRT export for rapid repeated clicks', async () => {
    const provider = vi.fn((_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return new Promise<Response>(() => {});
      return Promise.resolve(Response.json({
        success: true,
        data: [{
          id: 'a'.repeat(32), name: 'draft.srt', state: 'done',
          language: 'es', durationSeconds: 60, createdAt: null, folder: null,
        }],
        mediaImportEnabled: false,
      }));
    });
    vi.stubGlobal('fetch', provider);

    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'source.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
      await Promise.resolve();
    });
    act(() => {
      const button = screen.getByRole('button', { name: 'Importar transcripción' });
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(provider.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cancelar transcripción' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar transcripción' }));
    expect(screen.queryByRole('button', { name: 'Cancelar transcripción' })).toBeNull();
  });

  it('does not request a remote SRT when replacing a pending review is declined', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ success: true, data: {
          content: '1\n00:00:00,000 --> 00:00:05,000\nDoctor: Remote accepted',
        } })
        : Response.json({ success: true, data: [{
          id: 'a'.repeat(32), name: 'remote.srt', state: 'done',
          language: 'en', durationSeconds: 60, createdAt: null, folder: null,
        }], mediaImportEnabled: false }),
    );
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'local.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);
    const source = new File(['srt'], 'pending.srt', { type: 'text/plain' });
    const captions = Array.from({ length: 26 }, (_, i) =>
      `${i + 1}\n00:00:${String(i * 2).padStart(2, '0')},000 --> 00:00:${String(i * 2 + 1).padStart(2, '0')},000\nDoctor: Original ${i}`).join('\n\n');
    Object.defineProperty(source, 'text', { value: async () => captions });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [source] },
      });
    });
    expect(screen.getByText(/26 turnos disponibles y 25 seleccionados/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
    });
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Importar transcripción' }));
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(screen.getByText(/26 turnos disponibles y 25 seleccionados/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Importar transcripción' }));
    });
    expect(confirmation).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(screen.queryByText(/Seleccionar turnos de la transcripción/)).toBeNull();
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
  });

  it('ignores a preapproved remote SRT when manual selections change during transfer', async () => {
    let resolvePost!: (response: Response) => void;
    const fetcher = vi.fn((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise<Response>(resolve => { resolvePost = resolve; })
        : Promise.resolve(Response.json({ success: true, data: [{
          id: 'a'.repeat(32), name: 'remote.srt', state: 'done',
          language: 'en', durationSeconds: 60, createdAt: null, folder: null,
        }], mediaImportEnabled: false })),
    );
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'local.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);
    const source = new File(['srt'], 'pending.srt', { type: 'text/plain' });
    const captions = Array.from({ length: 26 }, (_, i) =>
      `${i + 1}\n00:00:${String(i * 2).padStart(2, '0')},000 --> 00:00:${String(i * 2 + 1).padStart(2, '0')},000\nDoctor: Original ${i}`).join('\n\n');
    Object.defineProperty(source, 'text', { value: async () => captions });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [source] },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
    });
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Importar transcripción' }));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(confirmation).toHaveBeenCalledOnce();
    // The original approval does not permit erasing subsequent local changes.
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección SRT' }));
    expect(screen.getByText(/26 turnos disponibles y 0 seleccionados/)).toBeTruthy();
    await act(async () => {
      resolvePost(Response.json({ success: true, data: {
        content: '1\n00:00:00,000 --> 00:00:05,000\nDoctor: Stale remote',
      } }));
      await Promise.resolve();
    });
    expect(screen.getByText(/26 turnos disponibles y 0 seleccionados/)).toBeTruthy();
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(confirmation).toHaveBeenCalledOnce();
  });

  it('warns before spending provider bandwidth if HappyScribe duration differs from the local recording', async () => {
    const fetcher = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(
      init?.method === 'POST'
        ? Response.json({ success: true, data: { content:
          '1\n00:00:00,000 --> 00:00:04,000\nDoctor: Verified local match' } })
        : Response.json({ success: true, data: [{
          id: 'a'.repeat(32), name: 'remote.srt', state: 'done',
          language: 'en', durationSeconds: 180, createdAt: null, folder: null,
        }], mediaImportEnabled: false }),
    ));
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
    });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Importar transcripción' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toMatch(/HappyScribe indica/);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(screen.getByText(/Importación cancelada: comprueba la duración/)).toBeTruthy();
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Importar transcripción' }));
    });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
  });

  it('uses one confirmation when both the provider duration and pending SRT review need attention', async () => {
    const fetcher = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(
      init?.method === 'POST'
        ? Response.json({ success: true, data: { content:
          '1\n00:00:00,000 --> 00:00:04,000\nDoctor: Remote approved' } })
        : Response.json({ success: true, data: [{
          id: 'a'.repeat(32), name: 'remote.srt', state: 'done',
          language: 'en', durationSeconds: 180, createdAt: null, folder: null,
        }], mediaImportEnabled: false }),
    ));
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'local.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);
    const file = new File(['srt'], 'pending.srt', { type: 'text/plain' });
    const captions = Array.from({ length: 26 }, (_, i) =>
      `${i + 1}\n00:00:${String(i * 2).padStart(2, '0')},000 --> 00:00:${String(i * 2 + 1).padStart(2, '0')},000\nDoctor: Turn ${i}`).join('\n\n');
    Object.defineProperty(file, 'text', { value: async () => captions });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Importar transcripción' }));
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toMatch(/HappyScribe indica/);
    expect(confirm.mock.calls[0][0]).toMatch(/turnos SRT pendientes/);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
  });

  it('asks before exporting a remote SRT that would overwrite edited cuts', async () => {
    const fetcher = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(
      init?.method === 'POST'
        ? Response.json({ success: true, data: {
          content: '1\n00:00:04,000 --> 00:00:10,000\nDoctor: Approved replacement',
        } })
        : Response.json({ success: true, data: [{
          id: 'a'.repeat(32), name: 'remote.srt', state: 'done',
          language: 'en', durationSeconds: 60, createdAt: null, folder: null,
        }], mediaImportEnabled: false }),
    ));
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'local.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
    });
    const confirmation = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Importar transcripción' }));
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(confirmation.mock.calls[0][0]).toMatch(/intervenciones o sugerencias pendientes/);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.getByText(/Importación cancelada. Se conservaron las intervenciones/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Importar transcripción' }));
    });
    expect(confirmation).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.getByText(/1 intervenciones cargadas/)).toBeTruthy();
  });

  it('discards remote subtitles after a new cut is created during an approved transfer', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise<Response>(resolve => { finish = resolve; })
        : Promise.resolve(Response.json({ success: true, data: [{
          id: 'a'.repeat(32), name: 'remote.srt', state: 'done',
          language: 'en', durationSeconds: 60, createdAt: null, folder: null,
        }], mediaImportEnabled: false })),
    );
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'local.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
    });
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Importar transcripción' }));
    expect(confirmation).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    await act(async () => {
      finish(Response.json({ success: true, data: {
        content: '1\n00:00:04,000 --> 00:00:10,000\nDoctor: Outdated remote',
      } }));
      await Promise.resolve();
    });
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    expect(screen.queryByText('Doctor: Outdated remote')).toBeNull();
    expect(confirmation).toHaveBeenCalledOnce();
  });

  it('aborts an obsolete HappyScribe SRT request when the administrator replaces the recording', async () => {
    let pendingImportSignal: AbortSignal | undefined;
    const list = {
      success: true,
      data: [{
        id: 'a'.repeat(32), name: 'sample.srt', state: 'done',
        language: 'es', durationSeconds: 60, createdAt: null, folder: null,
      }],
      mediaImportEnabled: false,
    };
    const remote = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        pendingImportSignal = init.signal as AbortSignal;
        return new Promise<Response>(() => {});
      }
      return Promise.resolve(Response.json(list));
    });
    vi.stubGlobal('fetch', remote);

    const { container } = render(<RoleplayStudioPage />);
    const input = screen.getByLabelText(/Grabación original MP3/i);
    fireEvent.change(input, {
      target: { files: [new File(['ID3-a'], 'first.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);

    await act(async () => { fireEvent.click(screen.getByText('Actualizar biblioteca')); });
    await act(async () => { fireEvent.click(screen.getByText('Importar transcripción')); });
    expect(pendingImportSignal).toBeDefined();
    expect(pendingImportSignal?.aborted).toBe(false);
    // The manual cancel must end the busy state without waiting for the server.
    fireEvent.click(screen.getByText('Cancelar transcripción'));
    expect(pendingImportSignal?.aborted).toBe(true);
    expect(screen.queryByText('Cancelar transcripción')).toBeNull();

    // A subsequent import must not be blocked by the aborted request.
    await act(async () => { fireEvent.click(screen.getByText('Importar transcripción')); });
    const secondSignal = pendingImportSignal;
    expect(secondSignal).toBeDefined();
    expect(secondSignal?.aborted).toBe(false);
    fireEvent.change(input, {
      target: { files: [new File(['ID3-b'], 'second.mp3', { type: 'audio/mpeg' })] },
    });
    expect(secondSignal?.aborted).toBe(true);
    expect(screen.queryByText('Cancelar transcripción')).toBeNull();
  });

  it('ignores subtitles that finish loading after the administrator changes the source recording', async () => {
    const { container } = render(<RoleplayStudioPage />);
    const audioInput = screen.getByLabelText(/Grabación original MP3/i);
    fireEvent.change(audioInput, {
      target: { files: [new File(['ID3-a'], 'first.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);

    let finishRead!: (value: string) => void;
    const read = new Promise<string>(resolve => { finishRead = resolve; });
    const subtitle = new File(['pending'], 'first.srt', { type: 'text/plain' });
    Object.defineProperty(subtitle, 'text', { configurable: true, value: () => read });
    fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
      target: { files: [subtitle] },
    });

    // The admin selects another recording before the old subtitle file finishes.
    fireEvent.change(audioInput, {
      target: { files: [new File(['ID3-b'], 'second.mp3', { type: 'audio/mpeg' })] },
    });
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);

    await act(async () => {
      finishRead('1\n00:00:00,000 --> 00:00:01,000\nDoctor: Private old dialogue');
      await read;
    });

    expect(screen.getByText(/Intervenciones \(0\/25\)/i)).toBeTruthy();
    expect(screen.queryByText(/Doctor · 1/i)).toBeNull();
    expect(screen.queryByText(/Private old dialogue/i)).toBeNull();
  });
});
