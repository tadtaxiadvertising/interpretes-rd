// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));

describe('Audio Studio manual selection from long SRT transcripts', () => {
  beforeEach(() => {
    let next = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'selected-' + ++next });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:medical-audio') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requires explicit selection and never silently publishes a 30-turn transcript', async () => {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'medical.mp3', { type: 'audio/mpeg' })] },
    });
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(audio);

    const captions = Array.from({ length: 30 }, (_, i) => {
      const a = String(i).padStart(2, '0');
      const b = String(i + 1).padStart(2, '0');
      return `${i + 1}\n00:00:${a},000 --> 00:00:${b},000\nDoctor: Review line ${i + 1}`;
    }).join('\n\n');
    const file = new File(['srt'], 'medical.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { configurable: true, value: async () => captions });

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(screen.getByText(/Hay 30 turnos disponibles y 25 seleccionados/)).toBeTruthy();
    const first = screen.getByRole('checkbox', { name: 'Seleccionar turno 1' }) as HTMLInputElement;
    const last = screen.getByRole('checkbox', { name: 'Seleccionar turno 30' }) as HTMLInputElement;
    expect(first.checked).toBe(true);
    expect(last.checked).toBe(false);

    fireEvent.click(first);
    fireEvent.click(last);
    expect(last.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Aplicar selección al editor/i }));
    expect(screen.getByText(/Intervenciones \(25\/25\)/)).toBeTruthy();
    expect(screen.getAllByText('Doctor: Review line 30').length).toBeGreaterThan(1);
  });
});
