// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import FocusTimeline from './FocusTimeline';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
type Props = ComponentProps<typeof FocusTimeline>;
type Turn = Props['active'][number];

describe('speaker timeline rendering', () => {
  it('reuses anchored geometry during playback but dispatches the latest selection and seek callbacks', () => {
    const first: Turn = { id: 'a', start: 10, end: 15, title: 'Consulta', speakerRole: 'doctor' };
    const second: Turn = { id: 'b', get start() { return 20; }, end: 25, title: 'Respuesta', speakerRole: 'patient' };
    const readStart = vi.spyOn(second, 'start', 'get');
    const props: Props = {
      duration: 120, playhead: 10, active: [first, second], excluded: [],
      selectedId: 'a', onSelect: vi.fn(), onSeek: vi.fn(),
    };
    const { rerender } = render(<FocusTimeline {...props}/>);
    const button = screen.getByRole('button', { name: 'Intervención: Respuesta' });
    expect(readStart).toHaveBeenCalled();
    readStart.mockClear();
    const onSelect = vi.fn(), onSeek = vi.fn();
    rerender(<FocusTimeline {...props} playhead={12.5} onSelect={onSelect} onSeek={onSeek}/>);
    expect(readStart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Intervención: Respuesta' })).toBe(button);
    expect(screen.getByRole('slider')).toHaveProperty('value', '12.5');
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('12,5 segundos');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith('b', false);
    expect(onSeek).toHaveBeenCalledWith(20);
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onSeek).not.toHaveBeenCalled();
  });

  it('refreshes compound cuts and selects excluded turns outside the initial window', () => {
    const first: Turn = { id: 'a', start: 10, end: 15, title: 'Consulta', speakerRole: 'doctor' };
    const compound: Turn = { id: 'b', start: 20, end: 28, title: 'Respuesta', speakerRole: 'patient',
      ranges: [{ start: 20, end: 22 }, { start: 26, end: 28 }] };
    const removed: Turn = { id: 'x', start: 60, end: 65, title: 'Retirada', speakerRole: 'interpreter' };
    const props: Props = { duration: 120, playhead: 10, active: [first, compound], excluded: [removed],
      selectedId: 'a', onSelect: vi.fn(), onSeek: vi.fn() };
    const { rerender } = render(<FocusTimeline {...props}/>);
    expect(screen.getByRole('button', { name: 'Intervención: Respuesta · corte 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Intervención: Respuesta · corte 2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Excluida: Retirada' })).toBeNull();
    const edited: Turn = { ...compound, title: 'Respuesta revisada', ranges: [{ start: 20, end: 22 }, { start: 40, end: 42 }], end: 42 };
    rerender(<FocusTimeline {...props} active={[first, edited]}/>);
    expect(screen.getByRole('button', { name: 'Intervención: Respuesta revisada · corte 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Intervención: Respuesta revisada · corte 2' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Localizar corte en línea de tiempo' }), { target: { value: 'x:x' } });
    expect(props.onSelect).toHaveBeenCalledWith('x', true);
    expect(props.onSeek).toHaveBeenCalledWith(60);
    expect(screen.getByRole('button', { name: 'Excluida: Retirada' })).toBeTruthy();
  });
});
