// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudioConsecutivePreview from './StudioConsecutivePreview';

const segments = [
  { id: 'doctor-1', title: 'Profesional médico', start: 0, end: 2, speakerRole: 'doctor' },
  { id: 'patient-2', title: 'Paciente', start: 3, end: 5, speakerRole: 'patient' },
];

describe('administrative consecutive preview only', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('plays one clip, enters a timed practice pause and advances manually', () => {
    const onStart = vi.fn();
    const { container } = render(
      <StudioConsecutivePreview sourceUrl="blob:local-only" sourceDuration={10}
        segments={segments} onStart={onStart} />
    );
    const audio = container.querySelector('audio')!;
    expect(screen.getByText(/Turno 1 de 2/)).toBeTruthy();
    expect(screen.getByText(/no graba, no crea sesiones ni modifica QA/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reproducir turno' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(0);
    expect(screen.getByText('Escuchando intervención')).toBeTruthy();

    audio.currentTime = 2.05;
    fireEvent.timeUpdate(audio);
    expect(screen.getByText(/Tu turno para interpretar/)).toBeTruthy();

    act(() => { vi.advanceTimersByTime(3600); }); // 2s * 1.25 + 1s
    expect(screen.getByText(/Pausa completada/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText(/Turno 2 de 2/)).toBeTruthy();
    expect(audio.currentTime).toBe(3);
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it('supports the original 4.5-second repetition protocol without storing recordings', () => {
    const { container } = render(
      <StudioConsecutivePreview sourceUrl="blob:local-only" sourceDuration={10} segments={segments} />
    );
    const audio = container.querySelector('audio')!;
    fireEvent.click(screen.getByRole('button', { name: 'Reproducir turno' }));
    fireEvent.click(screen.getByRole('button', { name: /Pedir repetición/ }));
    expect(screen.getByText(/Protocolo de repetición/)).toBeTruthy();
    expect(screen.getByText(/Repeticiones solicitadas: 1/)).toBeTruthy();

    act(() => { vi.advanceTimersByTime(4600); });
    expect(screen.getByText('Escuchando intervención')).toBeTruthy();
    expect(audio.currentTime).toBe(0);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it('stops a pending preview when the original editor starts playback', () => {
    const { rerender } = render(
      <StudioConsecutivePreview sourceUrl="blob:local-only" sourceDuration={10}
        segments={segments} interruptRevision={0} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reproducir turno' }));
    rerender(<StudioConsecutivePreview sourceUrl="blob:local-only" sourceDuration={10}
      segments={segments} interruptRevision={1} />);
    expect(screen.getByText('Listo para practicar')).toBeTruthy();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('cannot start if cuts overlap or contain only the interpreter', () => {
    const { rerender } = render(
      <StudioConsecutivePreview sourceUrl="blob:local-only" sourceDuration={10}
        segments={[{ ...segments[0], speakerRole: 'interpreter' }]} />
    );
    expect(screen.getByText(/Todos los cortes son del intérprete original/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reproducir turno' })).toBeNull();

    rerender(<StudioConsecutivePreview sourceUrl="blob:local-only" sourceDuration={10}
      segments={[segments[0], { ...segments[1], start: 1 }]} />);
    expect(screen.getByText(/solapados/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reproducir turno' })).toBeNull();
  });
});
