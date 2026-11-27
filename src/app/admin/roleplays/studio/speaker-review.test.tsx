// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';
import * as longMedia from '@/lib/roleplay-studio/long-media';

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

  function selectAudio(duration = 120) {
    const { container } = render(<RoleplayStudioPage />);
    fireEvent.change(screen.getByLabelText(/Grabación original MP3/i), {
      target: { files: [new File(['ID3'], 'medical.mp3', { type: 'audio/mpeg' })] },
    });
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'duration', { configurable: true, value: duration });
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

  it('applies the medical language pattern only to visible pending doctor and patient turns and supports undo', () => {
    selectAudio(180);
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    }
    const speakers = screen.getAllByLabelText('Perfil del hablante');
    const languages = screen.getAllByLabelText('Idioma de la intervención');
    expect(speakers).toHaveLength(5);
    expect(languages).toHaveLength(5);
    ['doctor', 'patient', 'doctor', 'interpreter', 'patient'].forEach((role, index) => {
      fireEvent.change(speakers[index], { target: { value: role } });
    });
    fireEvent.change(languages[2], { target: { value: 'es' } });
    const titles = screen.getAllByLabelText('Título');
    fireEvent.change(titles[4], { target: { value: 'Oculto' } });
    const search = screen.getByRole('searchbox', { name: 'Buscar intervenciones' });
    fireEvent.change(search, { target: { value: 'Oculto' } });
    expect(screen.getByRole('button', { name: /Aplicar médico EN \/ paciente ES \(1 pendientes visibles\)/ })).toBeTruthy();
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Aplicar médico EN \/ paciente ES \(3 pendientes visibles\)/ }));
    const values = () => (screen.getAllByLabelText('Idioma de la intervención') as HTMLSelectElement[]).map(item => item.value);
    expect(values()).toEqual(['en', 'es', 'es', 'unknown', 'es']);
    fireEvent.click(screen.getByRole('button', { name: /Deshacer asignación de idiomas/i }));
    expect(values()).toEqual(['unknown', 'unknown', 'es', 'unknown', 'unknown']);
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

  it('edits one intervention at a time in focus mode and preserves edits on navigation', () => {
    const player = selectAudio();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Modo enfoque' }));
    const selector = screen.getByLabelText('Ir a intervención') as HTMLSelectElement;
    fireEvent.change(selector, { target: { value: selector.options[0].value } });
    expect(screen.getAllByLabelText('Perfil del hablante')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Anterior intervención' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Perfil del hablante'), { target: { value: 'doctor' } });
    fireEvent.change(screen.getByLabelText('Idioma de la intervención'), { target: { value: 'en' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente intervención' }));
    expect(screen.getAllByLabelText('Perfil del hablante')).toHaveLength(1);
    expect((screen.getByLabelText('Perfil del hablante') as HTMLSelectElement).value).toBe('unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Anterior intervención' }));
    expect((screen.getByLabelText('Perfil del hablante') as HTMLSelectElement).value).toBe('doctor');
    expect((screen.getByLabelText('Idioma de la intervención') as HTMLSelectElement).value).toBe('en');
    expect(player.play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a lista' }));
    expect(screen.getAllByLabelText('Perfil del hablante')).toHaveLength(3);
  });

  it('switches between immersive editing and finalization without remounting media or losing edits', () => {
    const player = selectAudio();
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir escritorio de edición' }));
    expect(screen.getByRole('heading', { name: 'Escritorio de Audio Studio' })).toBeTruthy();
    expect(player.closest('[hidden]')).not.toBeNull();
    expect(player.isConnected).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Salir del escritorio' }));
    fireEvent.change(screen.getByLabelText('Perfil del hablante'), { target: { value: 'doctor' } });
    fireEvent.change(screen.getByLabelText('Idioma de la intervención'), { target: { value: 'en' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar' }));
    expect(screen.getByRole('heading', { name: 'Preparar paquete del roleplay' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Navegador de intervenciones' })).toBeNull();
    expect(screen.getByLabelText('Perfil del hablante').closest('[hidden]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.queryByRole('heading', { name: 'Preparar paquete del roleplay' })).toBeNull();
    expect((screen.getByLabelText('Perfil del hablante') as HTMLSelectElement).value).toBe('doctor');
    expect((screen.getByLabelText('Idioma de la intervención') as HTMLSelectElement).value).toBe('en');
    expect(player.isConnected).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Salir del escritorio' }));
    expect(player.closest('[hidden]')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Escritorio de Audio Studio' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abrir escritorio de edición' }));
    expect(player.play).not.toHaveBeenCalled();
  });

  it('returns from immersive finalization to the invalid intervention before exporting', () => {
    selectAudio();
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir escritorio de edición' }));
    fireEvent.change(screen.getByLabelText('Perfil del hablante'), { target: { value: 'interpreter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar plan local de cortes (JSON)' }));
    expect(screen.getByRole('navigation', { name: 'Navegador de intervenciones' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Editar' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('alert').some(element => element.textContent?.includes('intérprete original'))).toBe(true);
    expect(document.activeElement?.id).toBe('studio-intervention-studio-1');
  });

  it('controls the existing media player from focus mode without moving to the source panel', () => {
    const player = selectAudio();
    fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Modo enfoque' }));
    const cursor = screen.getByRole('slider', { name: 'Posición de grabación en modo enfoque' }) as HTMLInputElement;
    fireEvent.change(cursor, { target: { value: '20' } });
    expect(player.currentTime).toBe(20);
    fireEvent.click(screen.getByRole('button', { name: 'Retroceder audio 5 segundos' }));
    expect(player.currentTime).toBe(15);
    fireEvent.click(screen.getByRole('button', { name: 'Avanzar audio 5 segundos' }));
    expect(player.currentTime).toBe(20);
    fireEvent.click(screen.getByRole('button', { name: 'Escuchar intervención activa' }));
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(cursor.value).toBe(String(player.currentTime));
    expect(screen.getByRole('button', { name: 'Detener fragmento activo' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Pausar audio' }));
    expect(player.pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Escuchar intervención activa' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Volver a lista' }));
    expect(screen.queryByRole('slider', { name: 'Posición de grabación en modo enfoque' })).toBeNull();
  });

  it('keeps focus navigation within filtered interventions and allows direct selection', () => {
    selectAudio();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Añadir fragmento/i }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Modo enfoque' }));
    const selector = screen.getByLabelText('Ir a intervención') as HTMLSelectElement;
    fireEvent.change(selector, { target: { value: selector.options[2].value } });
    expect(screen.getByText('Intervención 3 de 3 · 3 de 3 visibles')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Intervención 2' },
    });
    expect(screen.getByText('Intervención 2 de 3 · 1 de 1 visibles')).toBeTruthy();
    expect(screen.getAllByLabelText('Perfil del hablante')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Siguiente intervención' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Anterior intervención' })).toHaveProperty('disabled', true);
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

  it('shows invalid overlapping SRT selections before apply and enables apply after correction', async () => {
    selectAudio();
    const source = new File(['srt'], 'overlapping.srt', { type: 'text/plain' });
    const stamp = (seconds: number) =>
      `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},000`;
    const transcript = Array.from({ length: 26 }, (_, index) => {
      const start = index === 0 ? 0 : index === 1 ? 2 : 4 + (index - 2) * 2;
      const end = index === 0 ? 3 : index === 1 ? 4 : start + 1;
      return `${index + 1}\n${stamp(start)} --> ${stamp(end)}\nDoctor: Turn ${index + 1}`;
    }).join('\n\n');
    Object.defineProperty(source, 'text', { value: async () => transcript });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [source] },
      });
    });

    const status = screen.getByRole('status', { name: 'Estado de selección SRT' });
    const apply = screen.getByRole('button', { name: /Aplicar selección al editor/i }) as HTMLButtonElement;
    expect(status.textContent).toContain('Audio seleccionado:');
    expect(apply.disabled).toBe(false);
    // The representative proposal changes which cues start selected.
    // Explicitly construct two conflicting manual turns to verify that the
    // same publish-time overlap validation still blocks applying them.
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección SRT' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar turno 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar turno 2' }));
    expect(status.textContent).toMatch(/Selección no válida:.*solapadas/);
    expect(apply.disabled).toBe(true);
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar turno 2' }));
    expect(status.textContent).toContain('Audio seleccionado:');
    expect(apply.disabled).toBe(false);
  });

  it('expands a transcript beyond 25 turns without allowing an oversized package', async () => {
    selectAudio();
    const file = new File(['srt'], 'expanded.srt', { type: 'text/plain' });
    const content = Array.from({ length: 30 }, (_, index) => {
      const start = String(index * 2).padStart(2, '0');
      const end = String(index * 2 + 1).padStart(2, '0');
      return `${index + 1}\n00:00:${start},000 --> 00:00:${end},000\nDoctor: Turn ${index}`;
    }).join('\n\n');
    Object.defineProperty(file, 'text', { value: async () => content });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [file] },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar selección compatible (hasta 100)' }));
    expect(screen.getByText(/30 turnos disponibles y 30 seleccionados/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar selección al editor (30)' }));
    expect(screen.getByText(/Intervenciones \(30\/100\)/)).toBeTruthy();
    expect(screen.getAllByLabelText('Perfil del hablante')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Descargar plan local de cortes (JSON)' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Guardar borrador ampliado' })).toBeTruthy();

    const partSelector = screen.getByLabelText('Parte del roleplay') as HTMLSelectElement;
    const exportPart = screen.getByRole('button', { name: 'Descargar parte seleccionada (JSON local)' });
    expect(exportPart).toHaveProperty('disabled', true);
    expect(partSelector.options).toHaveLength(3);
    const fingerprint = vi.spyOn(longMedia, 'fingerprintLocalMedia').mockResolvedValue('ab'.repeat(32));
    const createDraft = vi.spyOn(longMedia, 'createLongMediaDraft');
    const downloaded: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded.push(this.download);
    });
    fireEvent.change(partSelector, { target: { value: partSelector.options[2].value } });
    expect(exportPart).toHaveProperty('disabled', false);
    await act(async () => { fireEvent.click(exportPart); });
    expect(fingerprint).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft.mock.calls[0][2].map(turn => turn.start)).toEqual([50, 52, 54, 56, 58]);
    expect(createDraft.mock.results[0].value.version).toBe(1);
    expect(downloaded).toEqual(['roleplay-studio-parte-2.json']);
    expect(screen.getByText(/Intervenciones \(30\/100\)/)).toBeTruthy();
    expect(screen.getByText(/Parte 2 descargada/)).toBeTruthy();
  });

  it('keeps a pending 26-turn SRT review when another transcript import is declined', async () => {
    selectAudio();
    const first = new File(['srt'], 'first.srt', { type: 'text/plain' });
    const content = Array.from({ length: 26 }, (_, index) => {
      const start = String(index * 2).padStart(2, '0');
      const end = String(index * 2 + 1).padStart(2, '0');
      return `${index + 1}\n00:00:${start},000 --> 00:00:${end},000\nDoctor: Old turn ${index}`;
    }).join('\n\n');
    Object.defineProperty(first, 'text', { value: async () => content });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [first] },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección SRT' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar turno 2' }));
    expect(screen.getByText(/26 turnos disponibles y 1 seleccionados/)).toBeTruthy();

    const replacement = new File(['srt'], 'replacement.srt', { type: 'text/plain' });
    Object.defineProperty(replacement, 'text', {
      value: async () => '1\n00:00:00,000 --> 00:00:05,000\nDoctor: New turn',
    });
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [replacement] },
      });
    });
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/26 turnos disponibles y 1 seleccionados/)).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Seleccionar turno 2' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Cambio de transcripción cancelado/)).toBeTruthy();
    expect(screen.getByText(/Intervenciones \(0\/25\)/)).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Opcional: importar tiempos de transcripción/i), {
        target: { files: [replacement] },
      });
    });
    expect(confirmation).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Seleccionar turnos de la transcripción/)).toBeNull();
    expect(screen.getByText(/Intervenciones \(1\/25\)/)).toBeTruthy();
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
