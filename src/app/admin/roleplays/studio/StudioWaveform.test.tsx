// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import StudioWaveform from './StudioWaveform';

describe('Roleplay Studio accessible waveform timeline', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const audio = () => new File(['ID3'], 'recording.mp3', { type: 'audio/mpeg' });

  it('supports precise keyboard or slider seeking without requiring decoded waveform data', () => {
    const seek = vi.fn();
    render(
      <StudioWaveform
        file={audio()} duration={90} currentTime={20}
        segments={[{ id: 'clip', start: 10, end: 30 }]}
        onSeek={seek}
      />,
    );

    const slider = screen.getByRole('slider', { name: /Posición del reproductor en segundos/i });
    expect(slider.getAttribute('value')).toBe('20');
    fireEvent.change(slider, { target: { value: '25.5' } });
    expect(seek).toHaveBeenCalledWith(25.5);
    expect(screen.getByText('01:30')).toBeTruthy();
  });

  it('zooms into long recordings, clips markers to the window and navigates back to the cursor', () => {
    const seek = vi.fn();
    render(<StudioWaveform
      file={audio()} duration={7200} currentTime={3600}
      segments={[
        { id: 'nearby', start: 3590, end: 3610 },
        { id: 'distant', start: 100, end: 130 },
      ]}
      onSeek={seek}
    />);
    expect(screen.getAllByTestId('studio-window-segment')).toHaveLength(2);
    fireEvent.change(screen.getByRole('combobox', { name: 'Zoom de la línea de tiempo' }), {
      target: { value: '60' },
    });
    const slider = screen.getByRole('slider', { name: /Posición del reproductor en segundos/i });
    expect(slider.getAttribute('min')).toBe('3540');
    expect(slider.getAttribute('max')).toBe('3660');
    expect(screen.getAllByTestId('studio-window-segment')).toHaveLength(1);
    fireEvent.change(slider, { target: { value: '3605' } });
    expect(seek).toHaveBeenCalledWith(3605);
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.queryAllByTestId('studio-window-segment')).toHaveLength(0);
    expect(screen.getByText(/El cursor está fuera de esta ventana/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ir al cursor' }));
    expect(screen.getAllByTestId('studio-window-segment')).toHaveLength(1);
    expect(screen.getByText('02:00:00')).toBeTruthy();
  });

  it('keeps navigation available for long recordings without allocating decoded PCM', () => {
    const file = audio();
    const seek = vi.fn();
    render(<StudioWaveform file={file} duration={1500} currentTime={0} segments={[]} onSeek={seek}/>);
    expect(screen.getByText(/Vista de tiempo simplificada/)).toBeTruthy();
    expect(screen.getByText(/proteger la memoria del navegador/i)).toBeTruthy();

    fireEvent.change(screen.getByRole('slider'), { target: { value: '900' } });
    expect(seek).toHaveBeenCalledWith(900);
  });
});
