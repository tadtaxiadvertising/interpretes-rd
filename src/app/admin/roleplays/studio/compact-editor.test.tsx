// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    <a href={href}>{children}</a>,
}));

describe('Audio Studio compact editing', () => {
  beforeEach(() => {
    let n = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'compact-' + ++n });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:compact-audio'),
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

  function loadAudio(duration = 240) {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'sample.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: duration });
    fireEvent.loadedMetadata(player);
    return player;
  }

  it('filters interventions without altering the underlying project', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Intervención 2' },
    });
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    expect(screen.getByText(/#2 · Intervención 2/)).toBeTruthy();
    expect(screen.queryByText(/#1 · Intervención 1/)).toBeNull();
  });

  it('automatically shows condensed rows for larger sets, with accessible editors', () => {
    loadAudio(240);
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    }
    // Newly created sixth turn opens for editing even as compact mode begins.
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Contraer' })).toBeTruthy();
    expect(screen.getByLabelText('Inicio (segundos)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Contraer' }));
    expect(screen.queryByLabelText('Inicio (segundos)')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[2]);
    expect(screen.getByLabelText('Inicio (segundos)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Vista detallada' }));
    expect(screen.getAllByLabelText('Inicio (segundos)')).toHaveLength(6);
  });

  it('preserves editor-only SRT reference for both halves after splitting', async () => {
    const player = loadAudio(90);
    const captions = '1\n00:00:00,000 --> 00:00:10,000\nDoctor: Review instructions';
    const file = new File(['srt'], 'reference.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', {
      configurable: true, value: async () => captions,
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    player.currentTime = 5;
    fireEvent.click(screen.getByRole('button', { name: /Dividir intervención 1 en cursor/ }));
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    expect(screen.getAllByText('Doctor: Review instructions')).toHaveLength(2);
    const prompts = screen.getAllByLabelText('Instrucciones para el participante') as HTMLTextAreaElement[];
    expect(prompts.map(item => item.value)).toEqual(['', '']);
    fireEvent.click(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.getAllByText('Doctor: Review instructions')).toHaveLength(1);
  });

  it('splits at the playhead and merges adjacent compatible intervals', () => {
    const player = loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    player.currentTime = 15;
    fireEvent.click(screen.getByRole('button', { name: /Dividir intervención 1 en cursor/ }));
    expect(screen.getByText(/Intervenciones \(3\/25\)/)).toBeTruthy();
    const starts = screen.getAllByLabelText('Inicio (segundos)') as HTMLInputElement[];
    expect(starts.map(input => Number(input.value))).toEqual([0, 15, 30]);
    fireEvent.click(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ }));
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    const ends = screen.getAllByLabelText('Final (segundos)') as HTMLInputElement[];
    expect(Number(ends[0].value)).toBe(30);
  });

  it('adds a turn near the cursor even when another turn exists much later', () => {
    const player = loadAudio(3600);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    player.currentTime = 600;
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    player.currentTime = 35;
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    expect(screen.getByText(/Intervenciones \(3\/25\)/)).toBeTruthy();
    const starts = screen.getAllByLabelText('Inicio (segundos)') as HTMLInputElement[];
    const ends = screen.getAllByLabelText('Final (segundos)') as HTMLInputElement[];
    expect(starts.map(field => Number(field.value))).toEqual([0, 35, 600]);
    expect(ends.map(field => Number(field.value))).toEqual([30, 65, 630]);
  });

  it('clears a deleted turn and its editor-only transcript reference', async () => {
    loadAudio(90);
    const captions = '1\n00:00:00,000 --> 00:00:10,000\nDoctor: Fictional reference only';
    const file = new File(['srt'], 'reference.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', {
      configurable: true, value: async () => captions,
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(screen.getByText('Doctor: Fictional reference only')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar intervención 1' }));
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(screen.queryByText('Doctor: Fictional reference only')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    expect(screen.queryByText('Doctor: Fictional reference only')).toBeNull();
  });

  it('filters interventions pending speaker/language review and restores the complete list', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.change(screen.getAllByLabelText('Perfil del hablante')[0], {
      target: { value: 'doctor' },
    });
    fireEvent.change(screen.getAllByLabelText('Idioma de la intervención')[0], {
      target: { value: 'en' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Pendientes \(1\)/ }));
    expect(screen.queryByText(/#1 · Intervención 1/)).toBeNull();
    expect(screen.getByText(/#2 · Intervención 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Pendientes \(1\)/ }));
    expect(screen.getByText(/#1 · Intervención 1/)).toBeTruthy();
  });

  it('seeks directly to an intervention without playing or changing the editor', () => {
    const player = loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ir al inicio de intervención 2' }));
    expect(player.currentTime).toBe(30);
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('edits compact rows without opening their detailed editors', () => {
    loadAudio(240);
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    }
    const speaker = screen.getByRole('combobox', { name: 'Hablante rápido intervención 1' });
    const language = screen.getByRole('combobox', { name: 'Idioma rápido intervención 1' });
    fireEvent.change(speaker, { target: { value: 'doctor' } });
    fireEvent.change(language, { target: { value: 'en' } });
    expect(screen.getByRole('checkbox', { name: 'Pendientes (5)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Pendientes (5)' }));
    expect(screen.queryByRole('combobox', { name: 'Hablante rápido intervención 1' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Hablante rápido intervención 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pendientes (5)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vista detallada' }));

    const fullSpeakers = screen.getAllByLabelText('Perfil del hablante') as HTMLSelectElement[];
    const fullLanguages = screen.getAllByLabelText('Idioma de la intervención') as HTMLSelectElement[];
    expect(fullSpeakers[0].value).toBe('doctor');
    expect(fullLanguages[0].value).toBe('en');
    expect(screen.queryByRole('combobox', { name: 'Hablante rápido intervención 1' })).toBeNull();
  });

  it('clears stale review filters when the source recording changes', () => {
    const player = loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'not visible' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pendientes (1)' }));

    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'replacement.mp3', { type: 'audio/mpeg' })] },
    });
    fireEvent.loadedMetadata(player);
    expect((screen.getByRole('searchbox', { name: 'Buscar intervenciones' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('checkbox', { name: 'Pendientes (0)' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(/Intervenciones \(1\/25\)/)).toBeNull();
  });

});
