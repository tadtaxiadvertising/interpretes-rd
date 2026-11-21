// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    <a href={href}>{children}</a>,
}));

describe('Roleplay Studio waveforms and bilingual speaker editing', () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => 'studio-' + ++id });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:local-audio'),
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

  function selectAudio() {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'medical.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: 120 });
    fireEvent.loadedMetadata(player);
    return player;
  }

  it('seeks with the waveform slider and marks a precise segment boundary', () => {
    const player = selectAudio();
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    const slider = screen.getByRole('slider', { name: /Posición del reproductor/i });
    fireEvent.change(slider, { target: { value: '45.5' } });
    expect(player.currentTime).toBe(45.5);

    fireEvent.click(screen.getByRole('button', { name: /Marcar inicio actual/i }));
    expect((screen.getByLabelText('Inicio (segundos)') as HTMLInputElement).value).toBe('45.5');
  });

  it('omits original interpreter cues by default and supports safe EN/ES title labels', async () => {
    selectAudio();
    const subtitle = new File(['mock'], 'medical.srt', { type: 'text/plain' });
    const data = [
      '1', '00:00:00,000 --> 00:00:02,000', 'Doctor: How are you?', '',
      '2', '00:00:02,000 --> 00:00:03,000', 'Interpreter: Original interpreter rendition', '',
      '3', '00:00:03,000 --> 00:00:04,000', 'Paciente: Me duele la cabeza.',
    ].join('\n');
    Object.defineProperty(subtitle, 'text', { value: async () => data, configurable: true });

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [subtitle] },
      });
    });

    expect(screen.getByText(/Intervenciones \(2\/25\)/i)).toBeTruthy();
    expect(screen.getByText(/1 del intérprete original omitidas/i)).toBeTruthy();
    expect(screen.queryByText(/Original interpreter rendition/i)).toBeNull();
    expect(screen.getByText('Doctor: How are you?')).toBeTruthy();
    expect(screen.getByText('Paciente: Me duele la cabeza.')).toBeTruthy();

    const languages = screen.getAllByLabelText(/Idioma de la intervención/i);
    fireEvent.change(languages[0], { target: { value: 'en' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Aplicar perfil e idioma al título/i })[0]);
    expect((screen.getAllByLabelText('Título')[0] as HTMLInputElement).value)
      .toBe('Doctor · 1 (EN)');
  });

  it('excludes all recognized interpreter turns at once and restores private references on undo', async () => {
    selectAudio();
    fireEvent.click(screen.getByLabelText(/Excluir intervenciones del intérprete original al importar/i));
    const subtitle = new File(['mock'], 'dialogue.srt', { type: 'text/plain' });
    Object.defineProperty(subtitle, 'text', { value: async () => [
      '1', '00:00:00,000 --> 00:00:02,000', 'Doctor: Hello', '',
      '2', '00:00:02,000 --> 00:00:03,000', 'Interpreter: Original rendition', '',
      '3', '00:00:03,000 --> 00:00:04,000', 'Paciente: Hola',
    ].join('\n'), configurable: true });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [subtitle] },
      });
    });

    expect(screen.getByText(/Intervenciones \(3\/25\)/)).toBeTruthy();
    expect(screen.getByText('Interpreter: Original rendition')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir 1 intervención del intérprete' }));
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    expect(screen.queryByText('Interpreter: Original rendition')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer exclusión de intérpretes' }));
    expect(screen.getByText(/Intervenciones \(3\/25\)/)).toBeTruthy();
    expect(screen.getByText('Interpreter: Original rendition')).toBeTruthy();
  });

  it('assigns a chosen speaker only to pending visible turns and supports undo', () => {
    selectAudio();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    }
    const speakers = screen.getAllByLabelText('Perfil del hablante') as HTMLSelectElement[];
    expect(speakers).toHaveLength(3);
    fireEvent.change(speakers[0], { target: { value: 'patient' } });

    const bulk = screen.getByRole('combobox', { name: 'Hablante para pendientes' });
    fireEvent.change(bulk, { target: { value: 'nurse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Asignar hablante a 2 pendientes' }));

    expect((screen.getAllByLabelText('Perfil del hablante') as HTMLSelectElement[])
      .map(element => element.value)).toEqual(['patient', 'nurse', 'nurse']);
    expect(screen.getByText(/Perfil nurse asignado a 2 intervenciones/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer asignación de hablantes' }));
    expect((screen.getAllByLabelText('Perfil del hablante') as HTMLSelectElement[])
      .map(element => element.value)).toEqual(['patient', 'unknown', 'unknown']);
  });

  it('applies bulk speaker review only to turns currently shown by the search filter', () => {
    selectAudio();
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    }
    const titles = screen.getAllByLabelText('Título') as HTMLInputElement[];
    fireEvent.change(titles[0], { target: { value: 'Afuera de búsqueda' } });
    fireEvent.change(titles[1], { target: { value: 'Afuera de búsqueda 2' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Intervención' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Asignar hablante a 2 pendientes' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: '' },
    });
    expect((screen.getAllByLabelText('Perfil del hablante') as HTMLSelectElement[])
      .map(element => element.value)).toEqual(['unknown', 'unknown', 'doctor', 'doctor']);
  });

  it('shows global review progress independent of search filters and updates after edits', () => {
    selectAudio();
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    const summary = () => screen.getByRole('status', { name: 'Resumen de revisión de intervenciones' }).textContent || '';
    expect(summary()).toMatch(/Revisión de roles e idiomas:\s*0\/2 sin pendientes/);
    expect(summary()).toContain('2 sin hablante');
    expect(summary()).toContain('2 sin idioma');

    const speakers = screen.getAllByLabelText('Perfil del hablante');
    const languages = screen.getAllByLabelText('Idioma de la intervención');
    fireEvent.change(speakers[0], { target: { value: 'doctor' } });
    fireEvent.change(languages[0], { target: { value: 'en' } });
    expect(summary()).toMatch(/Revisión de roles e idiomas:\s*1\/2 sin pendientes/);
    expect(summary()).toContain('1 sin hablante');
    expect(summary()).toContain('1 sin idioma');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Intervención 2' },
    });
    expect(summary()).toMatch(/Revisión de roles e idiomas:\s*1\/2 sin pendientes/);
    expect(summary()).toContain('1 sin hablante');
  });

  it('identifies original interpreter turns as pending until excluded', () => {
    selectAudio();
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    fireEvent.change(screen.getByLabelText('Perfil del hablante'), {
      target: { value: 'interpreter' },
    });
    fireEvent.change(screen.getByLabelText('Idioma de la intervención'), {
      target: { value: 'en' },
    });
    const summary = screen.getByRole('status', { name: 'Resumen de revisión de intervenciones' });
    expect(summary.textContent).toMatch(/Revisión de roles e idiomas:\s*0\/1 sin pendientes/);
    expect(summary.textContent).toContain('1 del intérprete original por excluir');
    expect(summary.textContent).toContain('0 sin idioma');
  });

  it('navigates visible pending turns in chronological order without editing audio', () => {
    selectAudio();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    }
    const next = screen.getByRole('button', { name: 'Ir al siguiente pendiente' });
    fireEvent.click(next);
    expect((document.activeElement as HTMLElement)?.id).toBe('studio-intervention-studio-1');
    fireEvent.click(next);
    expect((document.activeElement as HTMLElement)?.id).toBe('studio-intervention-studio-2');

    // A search filter constrains navigation. If the prior turn is hidden,
    // the first visible pending turn receives focus.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Intervención 3' },
    });
    fireEvent.click(next);
    expect((document.activeElement as HTMLElement)?.id).toBe('studio-intervention-studio-3');
    expect(screen.getByText(/Intervenciones \(3\/25\)/)).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: '' },
    });
    expect((screen.getAllByLabelText('Perfil del hablante') as HTMLSelectElement[])
      .map(element => element.value)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('navigates backwards through pending turns and returns forwards without media playback', () => {
    const player = selectAudio();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    }
    const previous = screen.getByRole('button', { name: 'Ir al pendiente anterior' });
    const next = screen.getByRole('button', { name: 'Ir al siguiente pendiente' });
    fireEvent.click(previous);
    expect((document.activeElement as HTMLElement)?.id).toBe('studio-intervention-studio-3');
    fireEvent.click(previous);
    expect((document.activeElement as HTMLElement)?.id).toBe('studio-intervention-studio-2');
    fireEvent.click(next);
    expect((document.activeElement as HTMLElement)?.id).toBe('studio-intervention-studio-3');
    expect(player.play).not.toHaveBeenCalled();
  });

  it('respects filtered pending turns when navigating backwards', () => {
    selectAudio();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    }
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Intervención 3' },
    });
    expect(screen.queryByRole('button', { name: 'Ir al pendiente anterior' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ir al siguiente pendiente' }));
    expect((document.activeElement as HTMLElement)?.id).toBe('studio-intervention-studio-3');
  });

  it('hides next-pending navigation after the only turn is fully reviewed', () => {
    selectAudio();
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    expect(screen.getByRole('button', { name: 'Ir al siguiente pendiente' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Perfil del hablante'), { target: { value: 'doctor' } });
    fireEvent.change(screen.getByLabelText('Idioma de la intervención'), { target: { value: 'en' } });
    expect(screen.queryByRole('button', { name: 'Ir al siguiente pendiente' })).toBeNull();
  });


  it('completes an SRT review selection from filtered cues without changing existing clips', async () => {
    selectAudio();
    const source = new File(['srt'], 'many.srt', { type: 'text/plain' });
    const transcript = Array.from({ length: 28 }, (_, index) => {
      const start = String(index * 2).padStart(2, '0');
      const end = String(index * 2 + 1).padStart(2, '0');
      const label = index === 10 || index === 20 ? 'Special case' : 'Other turn';
      return `${index + 1}\n00:00:${start},000 --> 00:00:${end},000\nDoctor: ${label}`;
    }).join('\n\n');
    Object.defineProperty(source, 'text', { value: async () => transcript });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [source] },
      });
    });
    expect(screen.getByText(/28 turnos disponibles y 25 seleccionados/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección SRT' }));
    expect(screen.getByText(/28 turnos disponibles y 0 seleccionados/)).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar turnos en transcripción' }), {
      target: { value: 'Special case' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Completar con turnos compatibles de esta página' }));
    expect(screen.getByText(/28 turnos disponibles y 2 seleccionados/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Aplicar selección al editor \(2\)/i }));
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    expect(screen.queryByText(/Seleccionar turnos de la transcripción/)).toBeNull();
  });

  it('fills only the displayed SRT page, not unseen turns on other pages', async () => {
    selectAudio();
    const source = new File(['srt'], 'paged.srt', { type: 'text/plain' });
    const timestamp = (seconds: number) =>
      `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},000`;
    const transcript = Array.from({ length: 80 }, (_, index) =>
      `${index + 1}\n${timestamp(index)} --> ${timestamp(index + 1)}\nDoctor: Case ${index}`).join('\n\n');
    Object.defineProperty(source, 'text', { value: async () => transcript });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [source] },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección SRT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente página SRT' }));
    expect(screen.getByText('Mostrando 61–80 de 80 turnos')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Completar con turnos compatibles de esta página' }));
    expect(screen.getByText(/80 turnos disponibles y 20 seleccionados/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Anterior página SRT' }));
    expect((screen.getByRole('checkbox', { name: 'Seleccionar turno 1' }) as HTMLInputElement).checked)
      .toBe(false);
  });

  it('does not automatically select original interpreter cues when a long SRT requires review', async () => {
    selectAudio();
    fireEvent.click(screen.getByLabelText(/Excluir intervenciones del intérprete original al importar/i));
    const source = new File(['srt'], 'large.srt', { type: 'text/plain' });
    const transcript = Array.from({ length: 27 }, (_, index) => {
      const start = String(index * 2).padStart(2, '0');
      const end = String(index * 2 + 1).padStart(2, '0');
      return `${index + 1}\n00:00:${start},000 --> 00:00:${end},000\n${index === 3 ? 'Interpreter' : 'Doctor'}: Scene ${index}`;
    }).join('\n\n');
    Object.defineProperty(source, 'text', { value: async () => transcript });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [source] },
      });
    });
    expect(screen.getByText(/27 turnos disponibles y 25 seleccionados/)).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Seleccionar turno 4' }) as HTMLInputElement).checked)
      .toBe(false);
  });

  it('updates generated titles without another click but respects manual titles', async () => {
    selectAudio();
    const subtitle = new File(['mock'], 'dialogue.srt', { type: 'text/plain' });
    Object.defineProperty(subtitle, 'text', { value: async () =>
      '1\n00:00:00,000 --> 00:00:02,000\nDoctor: Hello', configurable: true });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [subtitle] },
      });
    });

    fireEvent.change(screen.getByLabelText('Idioma de la intervención'), { target: { value: 'en' } });
    const title = screen.getByLabelText('Título') as HTMLInputElement;
    expect(title.value).toBe('Doctor · 1 (EN)');
    fireEvent.change(title, { target: { value: 'Consulta personalizada' } });
    fireEvent.change(screen.getByLabelText('Idioma de la intervención'), { target: { value: 'es' } });
    expect(title.value).toBe('Consulta personalizada');
  });

});
