// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));

describe('Audio Studio repaired SRT import safety', () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'repair-cue-' + ++id });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:repair-mp3'),
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

  const cases: Array<{ title: string; seconds: number; lines: string[] }> = [
    {
      title: 'requires review when a small provider transcript is out of order',
      seconds: 60,
      lines: [
        '2', '00:00:03,000 --> 00:00:04,000', 'Patient: Second',
        '', '1', '00:00:01,000 --> 00:00:02,000', 'Doctor: First',
      ],
    },
    {
      title: 'requires review when a long cue is split into approximate windows',
      seconds: 720,
      lines: [
        '1', '00:00:00,000 --> 00:10:00,000', 'Doctor: Long reference',
      ],
    },
  ];

  for (const item of cases) {
    it(item.title, async () => {
      const { container } = render(<RoleplayStudioPage />);
      fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
        target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
      });
      const player = container.querySelector('audio')!;
      Object.defineProperty(player, 'duration', { configurable: true, value: item.seconds });
      fireEvent.loadedMetadata(player);

      const file = new File(['srt'], 'captions.srt', { type: 'text/plain' });
      Object.defineProperty(file, 'text', {
        value: async () => item.lines.join(String.fromCharCode(10)),
      });
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
          target: { files: [file] },
        });
        await Promise.resolve();
      });

      expect(screen.getByText(/Correcciones de tiempos para revisión/)).toBeTruthy();
      expect(screen.getByText(/Seleccionar turnos de la transcripción/)).toBeTruthy();
      expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    });
  }

  it('preselects short playable turns instead of a broad overlapping provider caption', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 360 });
    fireEvent.loadedMetadata(player);

    const file = new File(['srt'], 'overlapping.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', {
      value: async () => [
        '1', '00:00:00,000 --> 00:05:00,000', 'Doctor: Broad provider caption', '',
        '2', '00:00:00,000 --> 00:00:02,000', 'Patient: First turn', '',
        '3', '00:00:02,000 --> 00:00:04,000', 'Doctor: Second turn', '',
        '4', '00:00:04,000 --> 00:00:06,000', 'Patient: Third turn',
      ].join(String.fromCharCode(10)),
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
      await Promise.resolve();
    });

    expect(screen.getByText(/4 turnos disponibles y 3 seleccionados/)).toBeTruthy();
    expect(screen.getByText(/Correcciones de tiempos para revisión/)).toBeTruthy();
    expect(screen.getByText('Intervenciones (0/25)')).toBeTruthy();
  });

  it('opens 650 cues from a normal MP3 as paged candidates without replacing cuts', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 1800 });
    fireEvent.loadedMetadata(player);

    const timestamp = (seconds: number) =>
      '00:' + String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
      String(seconds % 60).padStart(2, '0') + ',000';
    const transcript = Array.from({ length: 650 }, (_unused, index) => {
      const start = index * 2;
      return String(index + 1) + '\n' + timestamp(start) + ' --> ' +
        timestamp(start + 1) + '\nDoctor: Source turn';
    }).join('\n\n');
    const file = new File(['srt'], 'many-valid-cues.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => transcript });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
      await Promise.resolve();
    });

    expect(screen.getByText(/650 turnos disponibles y 25 seleccionados/)).toBeTruthy();
    expect(screen.getByText('Intervenciones (0/25)')).toBeTruthy();
    expect(screen.getByText('Mostrando 1–60 de 650 turnos')).toBeTruthy();
    expect(screen.queryByText(/supera 500 intervenciones/)).toBeNull();
    const quality = screen.getByRole('status', { name: 'Resumen de calidad de selección SRT' });
    expect(quality.textContent).toMatch(/0 sin hablante identificado/);
    expect(quality.textContent).toMatch(/0 del intérprete original/);
    expect(quality.textContent).toMatch(/3\/3 partes de la grabación representadas/);
    // A one-click suggestion must represent the whole source, not just the
    // first 25 subtitles. Filtering the existing selection is read-only.
    fireEvent.click(screen.getByLabelText('Solo seleccionados'));
    expect(screen.getByText(/Mostrando 1–25 de 25 turnos/)).toBeTruthy();
    const selectedNumbers = screen.getAllByRole('checkbox', { name: /^Seleccionar turno \d+$/ })
      .map(node => Number((node.getAttribute('aria-label') ?? '').replace('Seleccionar turno ', '')));
    expect(selectedNumbers[0]).toBeLessThan(40);
    expect(selectedNumbers.some(value => value > 260 && value < 390)).toBe(true);
    expect(selectedNumbers.at(-1)).toBeGreaterThan(610);
    expect(selectedNumbers).toHaveLength(25);
    expect(screen.getByText('Intervenciones (0/25)')).toBeTruthy();
  });

  it('imports consecutive numbered subtitles as distinct roleplay turns', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);

    const file = new File(['srt'], 'packed-captions.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', {
      value: async () => [
        '1', '00:00:00,000 --> 00:00:01,000', 'Doctor: First',
        '2', '00:00:01,000 --> 00:00:02,000', 'Paciente: Second',
        '3', '00:00:02,000 --> 00:00:03,000', 'Doctor: Third',
      ].join('\n'),
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
      await Promise.resolve();
    });
    expect(screen.getByText('Intervenciones (3/25)')).toBeTruthy();
    expect(screen.getByText('Doctor: First')).toBeTruthy();
    expect(screen.getByText('Paciente: Second')).toBeTruthy();
    expect(screen.getByText('Doctor: Third')).toBeTruthy();
  });

  it('reviews recoverable malformed HappyScribe cues without applying clips automatically', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);
    const file = new File(['srt'], 'happyscribe-unusable-cues.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => [
      '1', '00:00:01,000 --> 00:00:01,000', 'Doctor: Inverted or empty',
      '', '2', '00:00:01,000 --> 00:00:03,000', 'Doctor: Valid first',
      '', '3', '00:00:04,000 --> 00:00:03,000', 'Patient: Reversed',
      '', '4', '00:00:05,000 --> 00:00:07,000', 'Patient: Valid second',
    ].join('\n') });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
      await Promise.resolve();
    });
    expect(screen.getByText(/2 intervalos invertidos o inferiores a 0,1 s omitidos/)).toBeTruthy();
    expect(screen.getByText(/2 turnos disponibles y 2 seleccionados/)).toBeTruthy();
    expect(screen.getByText('Intervenciones (0/25)')).toBeTruthy();
  });

  it('restores a balanced SRT suggestion after manual changes without changing the editor', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 360 });
    fireEvent.loadedMetadata(player);
    const toStamp = (seconds: number) => '00:' +
      String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
      String(seconds % 60).padStart(2, '0') + ',000';
    const content = Array.from({ length: 60 }, (_, index) => (
      String(index + 1) + '\n' +
      toStamp(index * 3) + ' --> ' + toStamp(index * 3 + 2) +
      '\nDoctor: Original line'
    )).join('\n\n');
    const file = new File(['mock'], '60-turns.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => content });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(screen.getByText(/60 turnos disponibles y 25 seleccionados/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección SRT' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar turno 1' }));
    expect(screen.getByText(/60 turnos disponibles y 1 seleccionados/)).toBeTruthy();

    const confirmation = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar propuesta equilibrada' }));
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/60 turnos disponibles y 1 seleccionados/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Recuperar propuesta equilibrada' }));
    expect(confirmation).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/60 turnos disponibles y 25 seleccionados/)).toBeTruthy();
    expect(screen.getByText(/Mostrando 1–25 de 25 turnos/)).toBeTruthy();
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(screen.getByText(/el editor no se modificó/)).toBeTruthy();
  });

  it('restores a cleared selection without a destructive confirmation', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(player);
    const file = new File(['mock'], 'four-turns.srt', { type: 'text/plain' });
    const caption = (seconds: number) => '00:' +
      String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
      String(seconds % 60).padStart(2, '0') + ',000';
    const content = Array.from({ length: 26 }, (_, index) => [
      String(index + 1),
      caption(index * 2) + ' --> ' + caption(index * 2 + 1),
      'Doctor: Reference turn',
    ].join('\n')).join('\n\n');
    Object.defineProperty(file, 'text', { value: async () => content });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección SRT' }));
    const confirmation = vi.spyOn(window, 'confirm');
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar propuesta equilibrada' }));
    expect(confirmation).not.toHaveBeenCalled();
    expect(screen.getByText(/26 turnos disponibles y 25 seleccionados/)).toBeTruthy();
  });

  it('jumps directly to flagged selected SRT cues and restores the original selection view', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 120 });
    fireEvent.loadedMetadata(player);

    const stamp = (seconds: number) => '00:' +
      String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
      String(seconds % 60).padStart(2, '0') + ',000';
    const captions = Array.from({ length: 30 }, (_, index) => [
      String(index + 1),
      stamp(index * 3) + ' --> ' + stamp(index * 3 + 2),
      index === 1 ? 'Speaker without label' : 'Doctor: Verified role',
    ].join('\n')).join('\n\n');
    const file = new File(['srt'], 'review.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => captions });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
      await Promise.resolve();
    });

    expect(screen.getByText(/30 turnos disponibles y 25 seleccionados/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección SRT' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar turno 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar turno 2' }));
    expect(screen.getByRole('status', { name: 'Resumen de calidad de selección SRT' })
      .textContent).toContain('1 sin hablante identificado');

    fireEvent.click(screen.getByRole('button', { name: 'Revisar 1 turno con alerta' }));
    expect((screen.getByRole('checkbox', { name: 'Solo seleccionados' }) as HTMLInputElement).checked)
      .toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Seleccionar turno 2' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Seleccionar turno 1' })).toBeNull();
    expect(screen.getByText(/30 turnos disponibles y 2 seleccionados/)).toBeTruthy();
    expect(screen.getByText('Intervenciones (0/25)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Volver a turnos seleccionados' }));
    expect(screen.getByRole('checkbox', { name: 'Seleccionar turno 1' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar turno 2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Volver a turnos seleccionados' })).toBeNull();
    expect(screen.getByText('Intervenciones (0/25)')).toBeTruthy();

    // Emptying the last flagged selection cannot trap the operator behind
    // an empty quality filter with no way to show all source cues again.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar turno 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revisar 1 turno con alerta' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar turno 2' }));
    expect(screen.getByRole('button', { name: 'Mostrar todos los turnos' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todos los turnos' }));
    expect((screen.getByRole('checkbox', { name: 'Solo seleccionados' }) as HTMLInputElement).checked)
      .toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Seleccionar turno 1' })).toBeTruthy();
    expect(screen.getByText('Intervenciones (0/25)')).toBeTruthy();
  });

  it('plays one SRT subtitle only until its end and can stop early without editing any clips', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'original.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 120 });
    fireEvent.loadedMetadata(player);
    const stamp = (seconds: number) => '00:' +
      String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
      String(seconds % 60).padStart(2, '0') + ',000';
    const cues = Array.from({ length: 30 }, (_, index) => [
      String(index + 1),
      stamp(index * 3) + ' --> ' + stamp(index * 3 + 2),
      'Doctor: Reference',
    ].join('\n')).join('\n\n');
    const file = new File(['srt'], 'source.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => cues });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
      await Promise.resolve();
    });

    // Ignore media resets performed while replacing the original recording.
    pause.mockClear();
    play.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Escuchar solo turno 2' }));
    expect(player.currentTime).toBe(3);
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Detener escucha de turno 2' })).toBeTruthy();
    player.currentTime = 4.9;
    fireEvent.timeUpdate(player);
    expect(pause).not.toHaveBeenCalled();
    player.currentTime = 5;
    fireEvent.timeUpdate(player);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Escuchar solo turno 2' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Escuchar solo turno 1' }));
    expect(player.currentTime).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Detener escucha de turno 1' }));
    expect(pause).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Intervenciones (0/25)')).toBeTruthy();
  });
});
