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
    fireEvent.change(speaker, { target: { value: 'interpreter' } });
    fireEvent.change(language, { target: { value: 'en' } });
    expect(screen.getByRole('checkbox', { name: 'Pendientes (6)' })).toBeTruthy();
    expect(screen.getByText(/Excluye esos fragmentos antes de exportar/)).toBeTruthy();
    fireEvent.change(speaker, { target: { value: 'doctor' } });
    expect(screen.queryByText(/Excluye esos fragmentos antes de exportar/)).toBeNull();
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

  it('divides at the midpoint when the player is outside the selected intervention', () => {
    const player = loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));

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
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.change(screen.getAllByLabelText('Perfil del hablante')[0], {
      target: { value: 'doctor' },
    });
    fireEvent.change(screen.getAllByLabelText('Perfil del hablante')[1], {
      target: { value: 'patient' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ }));
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/No se pueden unir voces o idiomas distintos/);
    expect(alert.closest('article')?.textContent).toMatch(/Intervención 1/);
  });

  it('physically joins two compatible distant cuts into one local-only v2 scene without the gap', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
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

  it('never merges a hidden next turn when review filters are active', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Intervención 1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Unir intervención 1 con siguiente/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/oculto por un filtro/);
    expect(screen.getByText(/Intervenciones \(2\/25\)/)).toBeTruthy();
  });

  it('auditions two distant turns without the gap and leaves both exported cuts intact', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.change(screen.getAllByLabelText('Inicio (segundos)')[1], { target: { value: '40' } });
    fireEvent.change(screen.getAllByLabelText('Perfil del hablante')[1], { target: { value: 'patient' } });
    expect(screen.queryByRole('button', { name: /Preescuchar intervenciones/ })).toBeNull();
    fireEvent.change(screen.getAllByLabelText('Perfil del hablante')[1], { target: { value: 'unknown' } });
    expect(screen.getByRole('button', { name: /Preescuchar intervenciones/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar intervenciones' }), {
      target: { value: 'Intervención 1' },
    });
    expect(screen.queryByRole('button', { name: /Preescuchar intervenciones/ })).toBeNull();
  });

  it('undoes the last split or merge without altering the original source', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Dividir intervención 1/ }));
    expect(screen.getByRole('button', { name: 'Deshacer última división o unión' })).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText('Título')[0], { target: { value: 'Editado' } });
    expect(screen.queryByRole('button', { name: 'Deshacer última división o unión' })).toBeNull();
  });

  it('ignores inactive secondary media errors but reports failures during an explicit audition', () => {
    loadAudio(120);
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/ }));
    fireEvent.change(screen.getAllByLabelText('Inicio (segundos)')[1], { target: { value: '40' } });

    const secondary = screen.getByLabelText('Reproductor de preescucha sin pausa') as HTMLAudioElement;
    expect(secondary.preload).toBe('none');
    fireEvent.error(secondary);
    expect(screen.queryByText(/El navegador no pudo reproducir la preescucha/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Preescuchar intervenciones/ }));
    fireEvent.error(secondary);
    expect(screen.getByText(/El navegador no pudo reproducir la preescucha/)).toBeTruthy();
  });

});
