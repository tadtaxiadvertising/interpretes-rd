// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));

describe('Audio Studio stale subtitle playback requests', () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'cue-preview-' + ++id });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:cue-preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true, value: vi.fn(),
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const importReview = async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'recording.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 120 });
    fireEvent.loadedMetadata(player);

    const stamp = (seconds: number) => '00:' +
      String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
      String(seconds % 60).padStart(2, '0') + ',000';
    const transcript = Array.from({ length: 30 }, (_, index) => [
      String(index + 1),
      stamp(index * 3) + ' --> ' + stamp(index * 3 + 2),
      'Doctor: Reference',
    ].join('\n')).join('\n\n');
    const file = new File(['fixture'], 'transcript.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => transcript });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
      await Promise.resolve();
    });
    expect(screen.getByText(/30 turnos disponibles y 25 seleccionados/)).toBeTruthy();
    return player;
  };

  it('ignores a rejected old play request while the next cue is being previewed', async () => {
    let rejectOld: (reason?: unknown) => void = () => {};
    const first = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined);
    const player = await importReview();
    fireEvent.click(screen.getByRole('button', { name: 'Escuchar solo turno 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Escuchar solo turno 2' }));
    expect(play).toHaveBeenCalledTimes(2);
    expect(player.currentTime).toBe(3);

    await act(async () => {
      rejectOld(new Error('Interrupted by a new play request'));
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Detener escucha de turno 2' })).toBeTruthy();
    expect(screen.queryByText('No fue posible escuchar este turno de la transcripción.')).toBeNull();
    player.currentTime = 5;
    fireEvent.timeUpdate(player);
    expect(screen.getByRole('button', { name: 'Escuchar solo turno 2' })).toBeTruthy();
    expect(screen.getByText('Intervenciones (0/25)')).toBeTruthy();
  });

  it('does not surface a late playback error after the operator stops listening', async () => {
    let rejectOld: (reason?: unknown) => void = () => {};
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectOld = reject; }),
    );
    await importReview();
    fireEvent.click(screen.getByRole('button', { name: 'Escuchar solo turno 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Detener escucha de turno 1' }));
    await act(async () => {
      rejectOld(new Error('Playback interrupted by stop'));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Escuchar solo turno 1' })).toBeTruthy();
    expect(screen.queryByText('No fue posible escuchar este turno de la transcripción.')).toBeNull();
    expect(screen.getByText('Intervenciones (0/25)')).toBeTruthy();
  });

  it('ignores queued pause and ended events when a newer subtitle is already playing', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const player = await importReview();

    fireEvent.click(screen.getByRole('button', { name: 'Escuchar solo turno 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Escuchar solo turno 2' }));
    expect(player.currentTime).toBe(3);
    expect(screen.getByRole('button', { name: 'Detener escucha de turno 2' })).toBeTruthy();

    // A previous pause/ended event may be delivered after the second
    // play() has resumed the same HTMLAudioElement.
    Object.defineProperty(player, 'paused', { configurable: true, value: false });
    Object.defineProperty(player, 'ended', { configurable: true, value: false });
    fireEvent.pause(player);
    fireEvent.ended(player);
    expect(screen.getByRole('button', { name: 'Detener escucha de turno 2' })).toBeTruthy();
    player.currentTime = 5;
    fireEvent.timeUpdate(player);
    expect(screen.getByRole('button', { name: 'Escuchar solo turno 2' })).toBeTruthy();
    expect(screen.getByText('Intervenciones (0/25)')).toBeTruthy();
  });

  it('still stops a preview on a real media pause or ended event', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const player = await importReview();

    fireEvent.click(screen.getByRole('button', { name: 'Escuchar solo turno 1' }));
    Object.defineProperty(player, 'paused', { configurable: true, value: true });
    fireEvent.pause(player);
    expect(screen.getByRole('button', { name: 'Escuchar solo turno 1' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Escuchar solo turno 2' }));
    Object.defineProperty(player, 'ended', { configurable: true, value: true });
    fireEvent.ended(player);
    expect(screen.getByRole('button', { name: 'Escuchar solo turno 2' })).toBeTruthy();
  });
});
