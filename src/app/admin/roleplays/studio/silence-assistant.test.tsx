// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));

describe('Audio Studio pause assistant is advisory, never auto-publishing', () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'silence-' + ++id });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:audio'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true, value: vi.fn(),
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    // Replacement now requires explicit consent when there are unsaved cuts.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function loadMp3() {
    const { container } = render(<RoleplayStudioPage />);
    const input = screen.getByLabelText(/Grabación original MP3/i);
    fireEvent.change(input, {
      target: { files: [new File(['ID3'], 'medical.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 12 });
    fireEvent.loadedMetadata(player);
    return { input, player };
  }

  const result = {
    success: true,
    durationSeconds: 12,
    silences: [{ start: 2, end: 3 }, { start: 7, end: 8 }],
  };

  it('displays suggestions without replacing the active draft until explicit approval', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => ({
      ok: true,
      json: async () => result,
    }));
    vi.stubGlobal('fetch', fetchMock);
    loadMp3();
    fireEvent.click(screen.getByRole('checkbox', { name: /Autorizo subir este MP3 al servidor/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/i)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Detectar pausas en servidor/i }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/roleplays/studio/silences');
    expect(screen.getByText(/2 pausas detectadas/i)).toBeTruthy();
    expect(screen.getByText(/Intervenciones \(1\/25\)/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Reemplazar con 3 cortes sugeridos/i }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByText(/Intervenciones \(3\/25\)/i)).toBeTruthy();
    expect((screen.getAllByLabelText('Título')[0] as HTMLInputElement).value)
      .toBe('Intervención sugerida 1');
    expect((screen.getAllByLabelText(/Perfil del hablante/i)[0] as HTMLSelectElement).value)
      .toBe('unknown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A consumed proposal must not remain available to erase later edits.
    expect(screen.queryByRole('button', { name: /Reemplazar con .* cortes sugeridos/i })).toBeNull();
  });

  it('applies suggestions to an untouched draft without a needless confirmation step', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => result }));
    vi.stubGlobal('fetch', fetchMock);
    loadMp3();
    fireEvent.click(screen.getByRole('checkbox', { name: /Autorizo subir este MP3 al servidor/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Detectar pausas en servidor/i }));
    });

    expect(screen.getByText(/Intervenciones \(0\/25\)/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Reemplazar con 3 cortes sugeridos/i }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Intervenciones \(3\/25\)/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('discards old silence proposals when valid SRT cues replace the editor draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => result })));
    loadMp3();
    fireEvent.click(screen.getByRole('checkbox', { name: /Autorizo subir este MP3 al servidor/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Detectar pausas en servidor/i }));
    });
    expect(screen.getByRole('button', { name: /Reemplazar con 3 cortes sugeridos/i })).toBeTruthy();
    const file = new File(['srt'], 'new-source.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: async () => '1\n00:00:00,000 --> 00:00:10,000\nDoctor: Verified replacement',
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.getByText('Doctor: Verified replacement')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reemplazar con .* cortes sugeridos/i })).toBeNull();
    expect(screen.queryByText(/2 pausas detectadas/i)).toBeNull();
  });

  it('preserves pending silence suggestions if SRT replacement is declined without existing cuts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => result })));
    loadMp3();
    fireEvent.click(screen.getByRole('checkbox', { name: /Autorizo subir este MP3 al servidor/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Detectar pausas en servidor/i }));
    });
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reemplazar con 3 cortes sugeridos/i })).toBeTruthy();
    const file = new File(['srt'], 'source.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () =>
      '1\n00:00:00,000 --> 00:00:05,000\nDoctor: First turn' });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reemplazar con 3 cortes sugeridos/i })).toBeTruthy();
    expect(screen.getByText(/Importación de cortes cancelada/)).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reemplazar con .* cortes sugeridos/i })).toBeNull();
  });

  it('preserves edited interventions and filters when the administrator declines a suggested replacement', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => result }));
    vi.stubGlobal('fetch', fetchMock);
    loadMp3();
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Turno editado manualmente' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Turno editado' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Autorizo subir este MP3 al servidor/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Detectar pausas en servidor/i }));
    });
    expect(screen.getByText(/Intervenciones \(1\/25\)/i)).toBeTruthy();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /Reemplazar con 3 cortes sugeridos/i }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByText(/Intervenciones \(1\/25\)/i)).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value)
      .toBe('Turno editado manualmente');
    expect((screen.getByRole('searchbox', { name: 'Buscar intervenciones' }) as HTMLInputElement).value)
      .toBe('Turno editado');
    expect(screen.getByText(/Cortes sugeridos no aplicados/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();

    // Explicitly accepting the next attempt replaces the draft and resets stale filters.
    fireEvent.click(screen.getByRole('button', { name: /Reemplazar con 3 cortes sugeridos/i }));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Intervenciones \(3\/25\)/i)).toBeTruthy();
    expect((screen.getByRole('searchbox', { name: 'Buscar intervenciones' }) as HTMLInputElement).value)
      .toBe('');
    expect(screen.getAllByLabelText('Título')).toHaveLength(3);
    expect(screen.queryByDisplayValue('Turno editado manualmente')).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('aborts an in-flight pause analysis when accepted SRT cuts replace the draft', async () => {
    let finish!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const request = vi.fn((_url: RequestInfo | URL, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return pending;
    });
    vi.stubGlobal('fetch', request);
    loadMp3();
    fireEvent.click(screen.getByRole('checkbox', { name: /Autorizo subir este MP3 al servidor/ }));
    fireEvent.click(screen.getByRole('button', { name: /Detectar pausas en servidor/i }));
    expect(signal?.aborted).toBe(false);
    const replacement = new File(['srt'], 'accepted.srt', { type: 'text/plain' });
    Object.defineProperty(replacement, 'text', {
      configurable: true,
      value: async () => '1\n00:00:00,000 --> 00:00:10,000\nDoctor: New accepted turn',
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [replacement] },
      });
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finish({ ok: true, json: async () => result } as Response);
      await pending;
    });
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByText('Doctor: New accepted turn')).toBeTruthy();
    expect(screen.queryByText(/2 pausas detectadas/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Reemplazar con .* cortes sugeridos/i })).toBeNull();
  });

  it('ignores an analysis that finishes after the admin has changed the original MP3', async () => {
    let finish!: (body: unknown) => void;
    const responsePending = new Promise<unknown>(resolve => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => responsePending));
    const { input, player } = loadMp3();
    fireEvent.click(screen.getByRole('checkbox', { name: /Autorizo subir este MP3 al servidor/ }));

    fireEvent.click(screen.getByRole('button', { name: /Detectar pausas en servidor/i }));
    fireEvent.change(input, {
      target: { files: [new File(['ID4'], 'second.mp3', { type: 'audio/mpeg' })] },
    });
    Object.defineProperty(player, 'duration', { configurable: true, value: 12 });
    fireEvent.loadedMetadata(player);

    await act(async () => {
      finish({ ok: true, json: async () => result });
      await responsePending;
    });
    expect(screen.queryByText(/2 pausas detectadas/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Reemplazar con/i })).toBeNull();
    expect(screen.getByText(/Intervenciones \(0\/25\)/i)).toBeTruthy();
  });
});
