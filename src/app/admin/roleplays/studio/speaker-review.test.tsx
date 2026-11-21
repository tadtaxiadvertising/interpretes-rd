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
