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
    expect(screen.getByText(/Intervenciones \\(0\\/25\\)/)).toBeTruthy();
  });
});
