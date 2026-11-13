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
