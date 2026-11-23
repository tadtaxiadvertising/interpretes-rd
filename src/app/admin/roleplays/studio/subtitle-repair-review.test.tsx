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
});
