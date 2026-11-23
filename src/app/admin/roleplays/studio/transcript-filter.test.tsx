// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));

describe('Audio Studio transcript review search', () => {
  beforeEach(() => {
    let i = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'cue-' + ++i });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:search-test'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true, value: vi.fn(),
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('finds a cue beyond the first page and preserves its original selection index', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'medical.mp3', { type: 'audio/mpeg' })] },
    });
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 180 });
    fireEvent.loadedMetadata(audio);

    const captions = Array.from({ length: 90 }, (_, i) => {
      const n = i + 1;
      const start = String(i).padStart(2, '0');
      const end = String(n).padStart(2, '0');
      const startTime = i < 60 ? `00:00:${start}` : `00:01:${String(i - 60).padStart(2, '0')}`;
      const endTime = n < 60 ? `00:00:${end}` : `00:01:${String(n - 60).padStart(2, '0')}`;
      return `${n}\n${startTime},000 --> ${endTime},000\nDoctor: ${n === 85 ? 'Special clinical term' : 'Routine note ' + n}`;
    }).join('\n\n');
    const subtitle = new File(['mock'], 'medical.srt', { type: 'text/plain' });
    Object.defineProperty(subtitle, 'text', {
      configurable: true, value: async () => captions,
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [subtitle] },
      });
    });

    expect(screen.getByText(/Hay 90 turnos disponibles/)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar turno 1' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Seleccionar turno 85' })).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar turnos en transcripción' }), {
      target: { value: 'Special clinical term' },
    });
    const special = screen.getByRole('checkbox', { name: 'Seleccionar turno 85' }) as HTMLInputElement;
    expect(special).toBeTruthy();
    // The balanced default may already include the searched term. A manual
    // reset must let the operator choose it without depending on that default.
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección SRT' }));
    expect(special.checked).toBe(false);
    fireEvent.click(special);
    expect(special.checked).toBe(true);
    expect(screen.getByText(/90 turnos disponibles y 1 seleccionados/)).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo seleccionados' }));
    expect(screen.getByRole('checkbox', { name: 'Seleccionar turno 85' })).toBeTruthy();
    expect(special.checked).toBe(true);
  });
});
