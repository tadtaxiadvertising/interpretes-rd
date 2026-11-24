// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));

describe('Audio Studio auxiliary gapless pair preview races', () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'pair-preview-' + ++id });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:pair-preview'),
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

  const importThreeSeparatedTurns = async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'recording.mp3', { type: 'audio/mpeg' })] },
    });
    const primary = container.querySelector('audio')!;
    Object.defineProperty(primary, 'duration', { configurable: true, value: 120 });
    fireEvent.loadedMetadata(primary);

    // Importing 25 or fewer clean cues applies them directly to the editor.
    // Use 30 valid cues to exercise the explicit SRT review workflow, then
    // manually choose the three separated turns needed by these player tests.
    const starts = [0, 10, 20, ...Array.from({ length: 27 }, (_, index) => 30 + index * 3)];
    const transcript = starts.map((start, index) => [
      String(index + 1),
      `00:${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')},000 --> 00:${String(Math.floor((start + 2) / 60)).padStart(2, '0')}:${String((start + 2) % 60).padStart(2, '0')},000`,
      'Doctor: Synthetic reference text',
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
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección SRT' }));
    for (const index of [1, 2, 3]) {
      fireEvent.click(screen.getByRole('checkbox', { name: `Seleccionar turno ${index}` }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar selección al editor (3)' }));
    expect(screen.getByText('Intervenciones (3/25)')).toBeTruthy();

    return screen.getByLabelText('Reproductor de preescucha sin pausa') as HTMLAudioElement;
  };

  const pairButton = (first: number, second: number) =>
    screen.getByRole('button', {
      name: `Preescuchar intervenciones ${first} y ${second} sin pausa`,
    });

  it('does not cancel a newer pair when an older play() promise rejects', async () => {
    let rejectOld: (reason?: unknown) => void = () => {};
    const pending = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementationOnce(() => pending).mockResolvedValue(undefined);
    const auxiliary = await importThreeSeparatedTurns();

    fireEvent.click(pairButton(1, 2));
    fireEvent.click(pairButton(2, 3));
    expect(play).toHaveBeenCalledTimes(2);
    expect(auxiliary.currentTime).toBe(10);

    await act(async () => {
      rejectOld(new Error('Interrupted by another play request'));
      await Promise.resolve();
    });
    expect(pairButton(2, 3).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('El navegador no pudo iniciar la preescucha sin pausa.')).toBeNull();

    auxiliary.currentTime = 12.1;
    fireEvent.timeUpdate(auxiliary);
    expect(auxiliary.currentTime).toBe(20);
    auxiliary.currentTime = 22;
    fireEvent.timeUpdate(auxiliary);
    expect(pairButton(2, 3).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Intervenciones (3/25)')).toBeTruthy();
  });

  it('ignores the rejection of a play() request after stopping its pair', async () => {
    let rejectOld: (reason?: unknown) => void = () => {};
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectOld = reject; }),
    );
    await importThreeSeparatedTurns();
    fireEvent.click(pairButton(1, 2));
    fireEvent.click(pairButton(1, 2));

    await act(async () => {
      rejectOld(new Error('Playback interrupted by stop'));
      await Promise.resolve();
    });
    expect(pairButton(1, 2).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('El navegador no pudo iniciar la preescucha sin pausa.')).toBeNull();
  });

  it('ignores stale pause, ended and error events while the new pair is playing', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const auxiliary = await importThreeSeparatedTurns();
    fireEvent.click(pairButton(1, 2));
    fireEvent.click(pairButton(2, 3));

    Object.defineProperty(auxiliary, 'paused', { configurable: true, value: false });
    Object.defineProperty(auxiliary, 'ended', { configurable: true, value: false });
    Object.defineProperty(auxiliary, 'error', { configurable: true, value: null });
    fireEvent.pause(auxiliary);
    fireEvent.ended(auxiliary);
    fireEvent.error(auxiliary);
    expect(pairButton(2, 3).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText(/El navegador no pudo reproducir la preescucha/)).toBeNull();
  });

  it('still stops the active pair when the auxiliary element really ends', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const auxiliary = await importThreeSeparatedTurns();
    fireEvent.click(pairButton(1, 2));
    Object.defineProperty(auxiliary, 'ended', { configurable: true, value: true });
    fireEvent.ended(auxiliary);
    expect(pairButton(1, 2).getAttribute('aria-pressed')).toBe('false');
  });
});
