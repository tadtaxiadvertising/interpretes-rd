// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function chooseProfile(index: number, profile: 'client' | 'spanish' | 'interpreter') {
    const labels = { client: 'Cliente · EN', spanish: 'Hispanohablante · ES', interpreter: 'Intérprete original — excluir · EN' };
    fireEvent.click(within(screen.getByRole('group', { name: 'Perfil de intervención ' + index }))
      .getByRole('button', { name: labels[profile] }));
  }

  function displayedLanguages() {
    return screen.getAllByRole('group', { name: /Perfil de intervención / }).map(group => {
      const metadata = group.closest('article')?.querySelector('h3 > span')?.textContent ?? '';
      const match = metadata.match(/ · (EN|ES|Idioma pendiente)$/);
      if (!match) throw new Error('Missing visible language metadata: ' + metadata);
      return match[1] === 'Idioma pendiente' ? 'unknown' : match[1].toLowerCase();
    });
  }

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

  it('finds generic profiles independently of custom titles and keeps all turns', () => {
    loadAudio(120);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    chooseProfile(1, 'client');
    chooseProfile(2, 'spanish');
    chooseProfile(3, 'interpreter');
    const titles = screen.getAllByLabelText('Título');
    titles.forEach((field, i) => fireEvent.change(field, { target: { value: 'Turno personalizado ' + (i + 1) } }));
    const search = screen.getByRole('searchbox', { name: 'Buscar intervenciones' });
    for (const [query, index] of [['cliente', 1], ['hispanohablante', 2], ['interprete', 3]] as const) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getAllByRole('group', { name: /Perfil de intervención / })).toHaveLength(1);
      expect(screen.getByRole('group', { name: 'Perfil de intervención ' + index })).toBeTruthy();
    }
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getAllByRole('group', { name: /Perfil de intervención / })).toHaveLength(3);
    expect(displayedLanguages()).toEqual(['en', 'es', 'en']);
  });

  it('filters interventions without altering the underlying project', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Intervención 2' },
    });
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    expect(screen.getByText(/#2 · Intervención 2/)).toBeTruthy();
    expect(screen.queryByText(/#1 · Intervención 1/)).toBeNull();
  });

  it('identifies a missing title and reopens the intervention hidden by an active search', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vista compacta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Contraer' }));
    const search = screen.getByRole('searchbox', { name: 'Buscar intervenciones' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'ningún resultado' } });
    expect(screen.queryByLabelText('Título')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Descargar plan local de cortes/ }));
    expect(screen.getAllByRole('alert').some(item =>
      item.textContent?.includes('Intervención 1: añade un título'))).toBe(true);
    expect(screen.getByText('añade un título antes de exportar.')).toBeTruthy();
    expect(search.value).toBe('');
    expect(screen.getByLabelText('Título')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Contraer' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Título'));
    expect(screen.getByLabelText('Título')).toHaveProperty('value', '');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('reveals an interpreter-original turn for correction instead of exporting it', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    chooseProfile(1, 'interpreter');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'turno oculto' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Descargar plan local de cortes/ }));
    expect(screen.getAllByRole('alert').some(item =>
      item.textContent?.includes('Intervención 1: elimina el fragmento del intérprete original'))).toBe(true);
    expect(screen.getByText('elimina el fragmento del intérprete original antes de exportar el roleplay.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Excluir 1 intervención del intérprete' })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Ir al inicio de intervención 1' }).closest('article'),
    );
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('reveals the turn that pushes selected audio beyond fifteen minutes without exporting', () => {
    loadAudio(1200);
    for (let i = 1; i <= 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
      const ends = screen.getAllByLabelText('Final (segundos)') as HTMLInputElement[];
      fireEvent.change(ends[i - 1], { target: { value: String(i * 300) } });
    }

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'ningún resultado' },
    });
    expect(screen.queryByLabelText('Final (segundos)')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Descargar plan local de cortes/ }));
    expect(screen.getAllByRole('alert').some(item =>
      item.textContent?.includes('Intervención 4: la selección acumulada supera 15 minutos'))).toBe(true);
    expect(screen.getByText('la selección acumulada supera 15 minutos. Reduce este corte o alguno de los anteriores antes de exportar.')).toBeTruthy();
    expect((screen.getByRole('searchbox', { name: 'Buscar intervenciones' }) as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Ir al inicio de intervención 4' }).closest('article'),
    );
    // Source preview only; an invalid export must not generate another download.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('automatically shows condensed rows for larger sets, with accessible editors', () => {
    loadAudio(240);
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
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

  it('preserves edited cuts when valid SRT replacement is declined', async () => {
    loadAudio(90);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Edición sin guardar' } });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    const file = new File(['srt'], 'reemplazo.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', {
      configurable: true, value: async () => '1\n00:00:00,000 --> 00:00:10,000\nDoctor: New subtitle',
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Edición sin guardar');
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.queryByText('Doctor: New subtitle')).toBeNull();
    expect(screen.getByText(/Importación de cortes cancelada/)).toBeTruthy();
  });

  it('accepts SRT replacement with confirmation and clears filters from the old project', async () => {
    loadAudio(90);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'turno que no existe' },
    });
    const file = new File(['srt'], 'nuevo.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', {
      configurable: true, value: async () => '1\n00:00:00,000 --> 00:00:10,000\nDoctor: Accepted subtitle',
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect((screen.getByRole('searchbox', { name: 'Buscar intervenciones' }) as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.getByText('Doctor: Accepted subtitle')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ir al inicio de intervención 1' })).toBeTruthy();
  });

  it('undoes an accepted subtitle replacement and restores edited private reference text', async () => {
    loadAudio(90);
    const first = new File(['srt'], 'first.srt', { type: 'text/plain' });
    Object.defineProperty(first, 'text', {
      configurable: true, value: async () =>
        '1\n00:00:00,000 --> 00:00:10,000\nDoctor: Private first reference',
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [first] },
      });
    });
    fireEvent.change(screen.getByLabelText('Título'), {
      target: { value: 'Mi intervención revisada' },
    });

    const replacement = new File(['srt'], 'second.srt', { type: 'text/plain' });
    Object.defineProperty(replacement, 'text', {
      configurable: true, value: async () =>
        '1\n00:00:20,000 --> 00:00:30,000\nPatient: New replacement text',
    });
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [replacement] },
      });
    });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByText('Patient: New replacement text')).toBeTruthy();
    expect(screen.queryByText('Doctor: Private first reference')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer importación de subtítulos' }));
    expect(screen.getByText('Doctor: Private first reference')).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Mi intervención revisada');
    expect(screen.queryByText('Patient: New replacement text')).toBeNull();
    expect(screen.getByText(/Importación de subtítulos deshecha/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Deshacer importación de subtítulos' })).toBeNull();
  });

  it('can undo the first imported SRT without retaining private captions', async () => {
    loadAudio(90);
    const file = new File(['srt'], 'fresh.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', {
      configurable: true, value: async () =>
        '1\n00:00:00,000 --> 00:00:10,000\nDoctor: Reference to clear',
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(screen.getByText('Doctor: Reference to clear')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer importación de subtítulos' }));
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(screen.queryByText('Doctor: Reference to clear')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.queryByText('Doctor: Reference to clear')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deshacer importación de subtítulos' })).toBeNull();
  });

  it('does not prompt or erase existing cuts for invalid subtitle files', async () => {
    loadAudio(90);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    const invalid = new File(['not subtitles'], 'wrong.txt', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [invalid] },
      });
    });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Selecciona un SRT o VTT/);
  });

  function longTranscript(): File {
    const stamp = (seconds: number) =>
      '00:' + String(Math.floor(seconds / 60)).padStart(2, '0') +
      ':' + String(seconds % 60).padStart(2, '0') + ',000';
    // The 26th cue requires the explicit selection flow (25-scene limit).
    const content = Array.from({ length: 26 }, (_, index) => {
      const start = index * 3;
      return String(index + 1) + '\n' + stamp(start) + ' --> ' +
        stamp(start + 1) + '\nDoctor: Source turn ' + (index + 1);
    }).join('\n\n');
    const file = new File(['srt'], 'long-reference.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { configurable: true, value: async () => content });
    return file;
  }

  it('closes long SRT review only after successfully applying selected cuts', async () => {
    loadAudio(90);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [longTranscript()] },
      });
    });
    expect(screen.getByText('Seleccionar turnos de la transcripción')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Aplicar selección al editor \(25\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Aplicar selección al editor \(25\)/ }));
    expect(screen.queryByText('Seleccionar turnos de la transcripción')).toBeNull();
    expect(screen.getByText(/Intervenciones \(25\/25\)/)).toBeTruthy();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Aplicar selección al editor/ })).toBeNull();

    // Undo must recover the pending SRT review, not just the previous editor.
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer importación de subtítulos' }));
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(screen.getByText('Seleccionar turnos de la transcripción')).toBeTruthy();
    expect(screen.getByText(/26 turnos disponibles y 25 seleccionados/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar selección al editor (25)' }));
    expect(screen.getByText(/Intervenciones \(25\/25\)/)).toBeTruthy();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('preserves long SRT review after declined replacement and closes it after acceptance', async () => {
    loadAudio(90);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getByLabelText('Título'), {
      target: { value: 'Edición pendiente' },
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [longTranscript()] },
      });
    });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar turnos en transcripción' }), {
      target: { value: 'Source turn 2' },
    });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /Aplicar selección al editor \(25\)/ }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByText('Seleccionar turnos de la transcripción')).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Edición pendiente');
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Aplicar selección al editor \(25\)/ }));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Seleccionar turnos de la transcripción')).toBeNull();
    expect(screen.getByText(/Intervenciones \(25\/25\)/)).toBeTruthy();
    expect(screen.queryByDisplayValue('Edición pendiente')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer importación de subtítulos' }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Edición pendiente');
    expect(screen.getByText('Seleccionar turnos de la transcripción')).toBeTruthy();
    expect(screen.getByText(/26 turnos disponibles y 25 seleccionados/)).toBeTruthy();
    expect((screen.getByRole('searchbox', {
      name: 'Buscar turnos en transcripción',
    }) as HTMLInputElement).value).toBe('Source turn 2');
    expect(screen.queryByRole('button', { name: 'Deshacer importación de subtítulos' })).toBeNull();
  });

  it('keeps playback when SRT replacement is declined but stops it on acceptance', async () => {
    loadAudio(90);
    // One cut is enough to verify that declined imports preserve playback.
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    expect(screen.getByRole('button', { name: 'Escuchar fragmento de intervención 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Escuchar fragmento de intervención 2' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Escuchar fragmento de intervención 1' }));
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    const file = new File(['srt'], 'new-cuts.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: async () => '1\n00:00:00,000 --> 00:00:10,000\nDoctor: Replacement',
    });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(pause).not.toHaveBeenCalled();
    expect(screen.getByText(/Importación de cortes cancelada/)).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalled();
    expect(screen.getByText('Doctor: Replacement')).toBeTruthy();
  });

  it('splits at the playhead and merges adjacent compatible intervals', () => {
    const player = loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
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

  it('sets language only on unreviewed non-interpreter turns and restores them with undo', () => {
    loadAudio(180);
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    }
    chooseProfile(1, 'client');
    chooseProfile(4, 'interpreter');
    fireEvent.change(screen.getAllByLabelText('Título')[1], {
      target: { value: 'Escenario personalizado' },
    });

    const apply = screen.getByRole('button', { name: 'Marcar pendientes como español' });
    expect(screen.getByText(/2 intervenciones visibles sin idioma/)).toBeTruthy();
    fireEvent.click(apply);
    expect(displayedLanguages()).toEqual(['en', 'es', 'es', 'en']);
    expect((screen.getAllByLabelText('Título') as HTMLInputElement[])
      .map(input => input.value)).toEqual([
        'Doctor · 1 (EN)', 'Escenario personalizado', 'Intervención · 3 (ES)', 'Intérprete · 4 (EN)',
      ]);
    expect(screen.queryByRole('button', { name: 'Marcar pendientes como español' })).toBeNull();
    expect(screen.getByText(/Idioma ES asignado a 2 intervenciones/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer asignación de idiomas' }));
    expect(displayedLanguages()).toEqual(['en', 'unknown', 'unknown', 'en']);
    expect((screen.getAllByLabelText('Título') as HTMLInputElement[])
      .map(input => input.value)).toEqual([
        'Doctor · 1 (EN)', 'Escenario personalizado', 'Intervención 3', 'Intérprete · 4 (EN)',
      ]);
    expect(screen.getByRole('button', { name: 'Marcar pendientes como español' })).toBeTruthy();
  });

  it('keeps quick classification visible independently of optional guides and protocols', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    const quick = screen.getByRole('region', { name: 'Clasificación rápida de perfiles' });
    expect(quick.closest('details')).toBeNull();
    expect(within(quick).getByRole('button', { name: 'Cliente · EN (2)' })).toBeTruthy();
    const guide = screen.getByText('Guía de interpretación y ayuda de clasificación').closest('details');
    const protocol = screen.getByText('Protocolos de interpretación consecutiva (opcional)').closest('details');
    expect(guide?.open).toBe(false);
    expect(protocol?.open).toBe(false);
    expect(guide).not.toBe(protocol);
    const pending = screen.getByRole('region', { name: 'Idiomas pendientes' });
    expect(pending.closest('details')).toBeNull();
    fireEvent.click(within(quick).getByRole('button', { name: 'Cliente · EN (2)' }));
    expect(screen.queryByRole('region', { name: 'Clasificación rápida de perfiles' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Idiomas pendientes' })).toBeNull();
    expect(displayedLanguages()).toEqual(['en', 'en']);
  });

  it('assigns profile and language in bulk only to visible compatible pending turns and undoes both', () => {
    loadAudio(180);
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    chooseProfile(1, 'client');
    const titles = screen.getAllByLabelText('Título');
    fireEvent.change(titles[1], { target: { value: 'Grupo revisado A' } });
    fireEvent.change(titles[2], { target: { value: 'Grupo revisado B' } });
    const search = screen.getByRole('searchbox', { name: 'Buscar intervenciones' });
    fireEvent.change(search, { target: { value: 'Grupo revisado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hispanohablante · ES (2)' }));
    fireEvent.change(search, { target: { value: '' } });
    expect(displayedLanguages()).toEqual(['en', 'es', 'es', 'unknown']);
    expect(within(screen.getByRole('group', { name: 'Perfil de intervención 2' }))
      .getByRole('button', { name: 'Hispanohablante · ES' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getAllByLabelText('Título')[1] as HTMLInputElement).value).toBe('Grupo revisado A');
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer asignación de hablantes' }));
    expect(displayedLanguages()).toEqual(['en', 'unknown', 'unknown', 'unknown']);
  });

  it('completes known legacy profiles with their corresponding languages and preserves unknown turns', async () => {
    loadAudio(90);
    const captions = '1\n00:00:00,000 --> 00:00:10,000\nNurse: Synthetic A\n\n2\n00:00:10,000 --> 00:00:20,000\nPatient: Synthetic B\n\n3\n00:00:20,000 --> 00:00:30,000\nUnassigned synthetic C';
    const file = new File(['srt'], 'reference.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => captions, configurable: true });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    expect(displayedLanguages()).toEqual(['unknown', 'unknown', 'unknown']);
    fireEvent.click(screen.getByRole('button', { name: 'Completar cliente EN / hispanohablante ES (2 pendientes visibles)' }));
    expect(displayedLanguages()).toEqual(['en', 'es', 'unknown']);
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer asignación de idiomas' }));
    expect(displayedLanguages()).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('never assigns languages to turns hidden by the active search filter', () => {
    loadAudio(180);
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    }
    const titles = screen.getAllByLabelText('Título') as HTMLInputElement[];
    fireEvent.change(titles[1], { target: { value: 'Solo inglés 2' } });
    fireEvent.change(titles[3], { target: { value: 'Solo inglés 4' } });
    const search = screen.getByRole('searchbox', { name: 'Buscar intervenciones' });
    fireEvent.change(search, { target: { value: 'Solo inglés' } });

    expect(screen.getByText(/2 intervenciones visibles sin idioma/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar pendientes como inglés' }));
    fireEvent.change(search, { target: { value: '' } });
    expect(displayedLanguages()).toEqual(['unknown', 'en', 'unknown', 'en']);

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer asignación de idiomas' }));
    expect(displayedLanguages()).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
  });

  it('adds a turn near the cursor even when another turn exists much later', () => {
    const player = loadAudio(3600);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    player.currentTime = 600;
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    player.currentTime = 35;
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    expect(screen.queryByText('Doctor: Fictional reference only')).toBeNull();
  });

  it('restores a deleted intervention and its editor-only transcript through undo', async () => {
    loadAudio(90);
    const captions = '1\n00:00:00,000 --> 00:00:10,000\nDoctor: Private reference for editor';
    const file = new File(['srt'], 'reference.srt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => captions, configurable: true });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });

    const title = screen.getByLabelText('Título') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Escenario revisado' } });
    expect(screen.getByText('Doctor: Private reference for editor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar intervención 1' }));

    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(screen.queryByText('Doctor: Private reference for editor')).toBeNull();
    expect(screen.getByRole('button', { name: 'Deshacer eliminación de intervención' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer eliminación de intervención' }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Escenario revisado');
    expect(screen.getByText('Doctor: Private reference for editor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Deshacer eliminación de intervención' })).toBeNull();
  });

  it('invalidates deletion undo when a new intervention is added', () => {
    loadAudio(90);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar intervención 1' }));
    expect(screen.getByRole('button', { name: 'Deshacer eliminación de intervención' })).toBeTruthy();
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();

    // A new edit deliberately invalidates the older removal snapshot.
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    expect(screen.queryByRole('button', { name: 'Deshacer eliminación de intervención' })).toBeNull();
    // Removing the only cut then adding one leaves exactly one new cut.
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
  });

  it('filters interventions pending speaker/language review and restores the complete list', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    chooseProfile(1, 'client');
    fireEvent.click(screen.getByRole('checkbox', { name: /Pendientes \(1\)/ }));
    // The visible title is now updated automatically after classifying its
    // speaker; row identity must not depend on the old placeholder title.
    expect(screen.queryByRole('button', { name: 'Ir al inicio de intervención 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ir al inicio de intervención 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Pendientes \(1\)/ }));
    expect(screen.getByText(/#1 · Doctor · 1 \(EN\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ir al inicio de intervención 1' })).toBeTruthy();
  });

  it('seeks directly to an intervention without playing or changing the editor', () => {
    const player = loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ir al inicio de intervención 2' }));
    expect(player.currentTime).toBe(30);
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('edits compact rows without opening their detailed editors', () => {
    loadAudio(240);
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    }
    chooseProfile(1, 'interpreter');
    expect(screen.getByRole('checkbox', { name: 'Pendientes (6)' })).toBeTruthy();
    expect(screen.getByText(/Excluye esos fragmentos antes de exportar/)).toBeTruthy();
    chooseProfile(1, 'client');
    expect(screen.queryByText(/Excluye esos fragmentos antes de exportar/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Pendientes (5)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Pendientes (5)' }));
    expect(screen.queryByRole('group', { name: 'Perfil de intervención 1' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Perfil de intervención 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pendientes (5)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vista detallada' }));

    expect(within(screen.getByRole('group', { name: 'Perfil de intervención 1' }))
      .getByRole('button', { name: 'Cliente · EN' }).getAttribute('aria-pressed')).toBe('true');
    expect(displayedLanguages()[0]).toBe('en');
    expect(screen.getAllByLabelText('Título')).toHaveLength(6);
  });

  it('preserves the current source and interventions when the file picker is cancelled', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [] },
    });
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('does not replace the source or discard edits when replacement is declined', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    const replacement = new File(['ID3'], 'replacement.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [replacement] },
    });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    // A fresh explicit choice and approval should replace the untouched source.
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'accepted-replacement.mp3', { type: 'audio/mpeg' })] },
    });
    expect(window.confirm).toHaveBeenCalledTimes(2);
    // The editor hides the timeline until metadata from the new source is known.
    const newPlayer = document.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(newPlayer, 'duration', { configurable: true, value: 120 });
    fireEvent.loadedMetadata(newPlayer);
    // Replacing the file intentionally resets duration until the browser
    // supplies fresh media metadata; jsdom never does so automatically.
    const player = document.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 120 });
    fireEvent.loadedMetadata(player);
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('preserves listening opt-in on declined replacement and resets it on accepted new recording', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Modo enfoque' }));
    const preference = () => screen.getByRole('checkbox', { name: 'Escuchar siguiente al confirmar' });
    expect(preference()).toHaveProperty('checked', false);
    fireEvent.click(preference());
    expect(preference()).toHaveProperty('checked', true);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'declined.mp3', { type: 'audio/mpeg' })] },
    });
    expect(preference()).toHaveProperty('checked', true);
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'accepted.mp3', { type: 'audio/mpeg' })] },
    });
    const replacementPlayer = document.querySelector('audio')!;
    Object.defineProperty(replacementPlayer, 'duration', { configurable: true, value: 120 });
    fireEvent.loadedMetadata(replacementPlayer);
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    const enterFocus = screen.queryByRole('button', { name: 'Modo enfoque' });
    if (enterFocus) fireEvent.click(enterFocus);
    expect(preference()).toHaveProperty('checked', false);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('preserves active audio, interventions and editor state when replacement media is invalid', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    const originalPlayer = document.querySelector('audio') as HTMLAudioElement;
    const originalSrc = originalPlayer.getAttribute('src');
    const invalid = new File(['text is not audio'], 'not-audio.txt', { type: 'text/plain' });

    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [invalid] },
    });

    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/formato|archivo|audio/i);
    expect((document.querySelector('audio') as HTMLAudioElement).getAttribute('src')).toBe(originalSrc);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('replaces an untouched source without unnecessary confirmation', () => {
    loadAudio(120);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'fresh.mp3', { type: 'audio/mpeg' })] },
    });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('clears stale review filters when the source recording changes', () => {
    const player = loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
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

  it('divides at the midpoint when the player is outside the selected intervention', () => {
    const player = loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));

    // This was previously a no-op, with the error located below the list.
    player.currentTime = 100;
    fireEvent.click(screen.getByRole('button', { name: /Dividir intervención 1 en cursor/ }));
    expect(screen.getByText(/Intervenciones \(3\/25\)/)).toBeTruthy();
    const ends = screen.getAllByLabelText('Final (segundos)') as HTMLInputElement[];
    expect(ends.map(input => Number(input.value))).toEqual([15, 30, 60]);
    expect(screen.getByText(/dividido en su punto medio/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ }));
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    expect(screen.getByText(/Unidas las intervenciones 1 y 2/)).toBeTruthy();
  });

  it('reports incompatible speakers beside the row and preserves both turns', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    chooseProfile(1, 'client');
    chooseProfile(2, 'spanish');
    fireEvent.click(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ }));
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/No se pueden unir voces o idiomas distintos/);
    expect(alert.closest('article')?.textContent).toMatch(/Doctor · 1/);
    // Profile classification changes the displayed title, not the row ID.
    expect(alert.closest('article')?.querySelector(
      '[aria-label="Ir al inicio de intervención 1"]',
    )).not.toBeNull();
  });

  it('physically joins two compatible distant cuts into one local-only v2 scene without the gap', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getAllByLabelText('Inicio (segundos)')[1], {
      target: { value: '40' },
    });
    expect(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ })
      .textContent).toMatch(/Unir sin pausa/);
    fireEvent.click(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.getByText(/Intervención compuesta/)).toBeTruthy();
    expect(screen.getByText(/pausa de 00:10.0 excluida/)).toBeTruthy();
    expect(screen.getByText(/unidas sin pausa/)).toBeTruthy();
    expect((screen.getAllByLabelText('Inicio (segundos)')[0] as HTMLInputElement).disabled).toBe(true);
    expect((screen.getAllByLabelText('Final (segundos)')[0] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Proyecto compuesto v2/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Separar cortes de intervención 1/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Escuchar unido/ }));
    const player = screen.getByLabelText('Reproductor de preescucha sin pausa') as HTMLAudioElement;
    player.currentTime = 30;
    fireEvent.timeUpdate(player);
    expect(player.currentTime).toBe(40);
    player.currentTime = 60;
    fireEvent.timeUpdate(player);

    fireEvent.click(screen.getByRole('button', { name: /Separar cortes de intervención 1/ }));
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    expect((screen.getAllByLabelText('Inicio (segundos)')[0] as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer última división o unión' }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    expect(screen.getByText(/Intervención compuesta/)).toBeTruthy();
  });

  it('never reactivates a previous server upload after joining and separating v2 cuts', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('radio', { name: /Servidor \(opcional\)/i }));
    expect((screen.getByRole('radio', { name: /Servidor \(opcional\)/i }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getAllByLabelText('Inicio (segundos)')[1], { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ }));
    expect(screen.getByText(/la exportación local se ha activado automáticamente/i)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Servidor \(opcional\)/i })).toBeNull();
    expect(screen.getByRole('link', { name: /Cómo obtener el exportador local actualizado/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Separar cortes de intervención 1/ }));
    const local = screen.getByRole('radio', { name: /Local \(predeterminado\)/i }) as HTMLInputElement;
    const server = screen.getByRole('radio', { name: /Servidor \(opcional\)/i }) as HTMLInputElement;
    expect(local.checked).toBe(true);
    expect(server.checked).toBe(false);
    // Undo must not silently opt back into a previously selected upload path.
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer última división o unión' }));
    expect(screen.queryByRole('radio', { name: /Servidor \(opcional\)/i })).toBeNull();
  });

  it('never merges a hidden next turn when review filters are active', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Intervención 1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/oculto por un filtro/);
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
  });

  it('uses the same generic profile search for the list, audition and merge', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    chooseProfile(1, 'client');
    chooseProfile(2, 'client');
    fireEvent.change(screen.getAllByLabelText('Inicio (segundos)')[1], { target: { value: '40' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), { target: { value: 'cliente' } });
    expect(screen.getAllByRole('group', { name: /Perfil de intervención / })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Preescuchar intervenciones 1 y 2 sin pausa' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(screen.getByText(/se saltan 00:10.0/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
  });

  it('auditions two distant turns without the gap and leaves both exported cuts intact', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getAllByLabelText('Inicio (segundos)')[1], { target: { value: '40' } });

    const startButton = screen.getByRole('button', {
      name: 'Preescuchar intervenciones 1 y 2 sin pausa',
    });
    fireEvent.click(startButton);
    const audio = screen.getByLabelText('Reproductor de preescucha sin pausa') as HTMLAudioElement;
    expect(audio.currentTime).toBe(0);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(screen.getByText(/se saltan 00:10.0/)).toBeTruthy();

    audio.currentTime = 30;
    fireEvent.timeUpdate(audio);
    expect(audio.currentTime).toBe(40);
    audio.currentTime = 60;
    fireEvent.timeUpdate(audio);
    expect(screen.getByRole('button', {
      name: 'Preescuchar intervenciones 1 y 2 sin pausa',
    }).textContent).toBe('Escuchar sin pausa');

    const starts = screen.getAllByLabelText('Inicio (segundos)') as HTMLInputElement[];
    const ends = screen.getAllByLabelText('Final (segundos)') as HTMLInputElement[];
    expect(starts.map(item => Number(item.value))).toEqual([0, 40]);
    expect(ends.map(item => Number(item.value))).toEqual([30, 60]);
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
  });

  it('does not offer gapless audition for a mismatched speaker or a hidden following turn', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getAllByLabelText('Inicio (segundos)')[1], { target: { value: '40' } });
    chooseProfile(2, 'spanish');
    expect(screen.queryByRole('button', { name: /Preescuchar intervenciones/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer edición de intervención' }));
    expect(screen.getByRole('button', { name: /Preescuchar intervenciones/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Intervención 1' },
    });
    expect(screen.queryByRole('button', { name: /Preescuchar intervenciones/ })).toBeNull();
  });

  it('undoes the last split or merge without altering the original source', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Dividir intervención 1/ }));
    expect(screen.getByText(/Intervenciones \(3\/25\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer última división o unión' }));
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Deshacer última división o unión' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ }));
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer última división o unión' }));
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
  });

  it('invalidates undo after manually editing a restored turn', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Dividir intervención 1/ }));
    expect(screen.getByRole('button', { name: 'Deshacer última división o unión' })).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText('Título')[0], { target: { value: 'Editado' } });
    expect(screen.queryByRole('button', { name: 'Deshacer última división o unión' })).toBeNull();
  });

  it('ignores inactive secondary media errors but reports failures during an explicit audition', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/ }));
    fireEvent.change(screen.getAllByLabelText('Inicio (segundos)')[1], { target: { value: '40' } });

    const secondary = screen.getByLabelText('Reproductor de preescucha sin pausa') as HTMLAudioElement;
    expect(secondary.preload).toBe('none');
    fireEvent.error(secondary);
    expect(screen.queryByText(/El navegador no pudo reproducir la preescucha/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Preescuchar intervenciones/ }));
    // A real decoding failure sets HTMLMediaElement.error. An old queued
    // error event with a cleared error must not interrupt another preview.
    Object.defineProperty(secondary, 'error', { configurable: true, value: { code: 3 } });
    fireEvent.error(secondary);
    expect(screen.getByText(/El navegador no pudo reproducir la preescucha/)).toBeTruthy();
  });

});
