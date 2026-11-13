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
    fireEvent.click(screen.getByRole('button', { name: /Añadir intervención/i }));
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
});
