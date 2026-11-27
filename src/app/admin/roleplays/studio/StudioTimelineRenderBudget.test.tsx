// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { STUDIO_MAX_EDITOR_SEGMENTS } from '@/lib/roleplay-studio/draft';
import { MAX_LOCAL_MEDIA_SECONDS } from '@/lib/roleplay-studio/long-media';
import FocusTimeline from './FocusTimeline';
import StudioWaveform from './StudioWaveform';

type Turn = ComponentProps<typeof FocusTimeline>['active'][number];
afterEach(cleanup);

describe('large-project timeline render budget', () => {
  it('does not revisit static interval geometry across 32 playback updates at the editor limit', () => {
    const duration = MAX_LOCAL_MEDIA_SECONDS;
    const count = STUDIO_MAX_EDITOR_SEGMENTS;
    let intervalReads = 0;
    const turns: Turn[] = Array.from({ length: count }, (_, index) => {
      const start = 10 + index * Math.floor(duration / count);
      return {
        id: 'turn-' + index,
        title: 'Intervención ' + (index + 1),
        get start() { intervalReads++; return start; },
        end: start + 5,
        speakerRole: index % 2 === 0 ? 'doctor' : 'patient',
      };
    });
    const file = new File(['synthetic metadata fixture'], 'long.mp4', { type: 'video/mp4' });
    const readMedia = vi.fn(async () => new ArrayBuffer(0));
    Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: readMedia });
    const excluded: Turn[] = [];
    const onSelect = vi.fn();
    const onSeek = vi.fn();
    const initialPosition = duration / 2;
    function Project({ position, active }: { position: number; active: readonly Turn[] }) {
      return <>
        <StudioWaveform file={file} duration={duration} currentTime={position} segments={active} onSeek={onSeek}/>
        <FocusTimeline duration={duration} playhead={position} active={active} excluded={excluded}
          selectedId={active[0].id} onSelect={onSelect} onSeek={onSeek}/>
      </>;
    }
    const { rerender } = render(<Project position={initialPosition} active={turns}/>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Escala de intervenciones' }), {
      target: { value: '0' },
    });
    expect(screen.getAllByTestId('studio-window-segment')).toHaveLength(count);
    expect(screen.getAllByRole('button', { name: /^Intervención: Intervención / })).toHaveLength(count);
    expect(intervalReads).toBeGreaterThan(0);

    // Deterministic work counter, not a wall-clock or heap benchmark.
    intervalReads = 0;
    const ticks = 32;
    for (let tick = 1; tick <= ticks; tick++) {
      rerender(<Project position={initialPosition + tick / 4} active={turns}/>);
    }
    expect(intervalReads).toBe(0);
    expect(readMedia).not.toHaveBeenCalled();
    const position = initialPosition + ticks / 4;
    expect(screen.getByRole('slider', { name: 'Posición en la ventana temporal' })).toHaveProperty('value', String(position));
    expect(screen.getByLabelText('Tiempo exacto del cursor').textContent).toBe('06:00:08.00');

    // Editing invalidates the cache; both views must reflect the new interval.
    const last = turns[count - 1];
    const start = last.start + 1;
    const edited = [...turns.slice(0, -1), { ...last, start, title: 'Última revisada' }];
    intervalReads = 0;
    rerender(<Project position={position} active={edited}/>);
    expect(intervalReads).toBeGreaterThan(0);
    const markers = screen.getAllByTestId('studio-window-segment');
    expect(markers).toHaveLength(count);
    expect(Number(markers[count - 1].getAttribute('x'))).toBeCloseTo(start / duration * 720, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Intervención: Última revisada' }));
    expect(onSelect).toHaveBeenCalledWith(last.id, false);
    expect(onSeek).toHaveBeenCalledWith(start);
    expect(readMedia).not.toHaveBeenCalled();
  });
});
