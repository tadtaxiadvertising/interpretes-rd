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
