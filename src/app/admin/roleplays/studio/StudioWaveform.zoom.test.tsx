// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import StudioWaveform from './StudioWaveform';

describe('Audio Studio long-recording timeline', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('supports magnification and panning without decoding a long source file', () => {
    const file = new File(['ID3'], 'two-hours.mp3', { type: 'audio/mpeg' });
    const seek = vi.fn();
    render(<StudioWaveform file={file} duration={7200} currentTime={0} segments={[]} onSeek={seek}/>);
    expect(screen.getByText(/Vista de tiempo simplificada/)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Zoom de la línea de tiempo' }), {
      target: { value: '64' },
    });
    expect(screen.getByText('Ventana: 01:52')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Desplazar línea de tiempo hacia adelante' }));
    // Manual panning while paused must not be overridden by playhead following.
    expect(screen.getByText('01:24')).toBeTruthy();
    fireEvent.change(screen.getByRole('slider', { name: 'Posición del reproductor en segundos' }), {
      target: { value: '3500' },
    });
    expect(seek).toHaveBeenCalledWith(3500);
  });
});
