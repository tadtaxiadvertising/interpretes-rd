// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RoleplayScenario } from './RoleplayScenario';

const first = {
  id: 'scenario-one',
  order: 1,
  title: 'First roleplay',
  baseAudioUrl: '/tests/first.mp3',
};
const second = { ...first, id: 'scenario-two', title: 'Second roleplay', baseAudioUrl: '/tests/second.mp3' };
const shared = {
  currentIndex: 0,
  totalScenarios: 2,
  onNext: vi.fn(),
  baseVolume: 1,
  onVolumeChange: vi.fn(),
};

let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('participant scenario playback controls', () => {
  it('repeats only after a completed listen and the full 4.5-second wait', async () => {
    const { container } = render(<RoleplayScenario scenario={first} {...shared} />);
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Solicitar repetición/ })).toBeNull();

    fireEvent.ended(audio!);
    fireEvent.click(screen.getByRole('button', { name: /Solicitar repetición/ }));
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('4,5 segundos');
    act(() => { vi.advanceTimersByTime(4499); });
    expect(play).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('cancels pending repetition when the scenario changes', () => {
    const { container, rerender } = render(<RoleplayScenario scenario={first} {...shared} />);
    fireEvent.ended(container.querySelector('audio')!);
    fireEvent.click(screen.getByRole('button', { name: /Solicitar repetición/ }));
    rerender(<RoleplayScenario scenario={second} {...shared} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(play).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Solicitar repetición/ })).toBeNull();
  });

  it('cancels a delayed repetition before advancing to the response workflow', () => {
    const onNext = vi.fn();
    const { container } = render(<RoleplayScenario scenario={first} {...shared} onNext={onNext} />);
    fireEvent.ended(container.querySelector('audio')!);
    fireEvent.click(screen.getByRole('button', { name: /Solicitar repetición/ }));
    fireEvent.click(screen.getByRole('button', { name: /Grabar respuesta/ }));
    expect(onNext).toHaveBeenCalledOnce();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(play).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pauses an already playing base clip before the recording callback executes', () => {
    const onNext = vi.fn(() => {
      expect(pause).toHaveBeenCalledOnce();
    });
    const { container } = render(<RoleplayScenario scenario={first} {...shared} onNext={onNext} />);
    const audio = container.querySelector('audio')!;
    fireEvent.ended(audio);
    fireEvent.play(audio);
    expect(screen.getByRole('button', { name: 'Pausar audio base' })).toBeTruthy();
    pause.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Grabar respuesta/ }));
    expect(pause).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Reproducir audio base' })).toBeTruthy();
  });

  it('exposes accessible names for the base-audio playback and mute controls', () => {
    render(<RoleplayScenario scenario={first} {...shared} />);
    expect(screen.getByRole('button', { name: 'Reproducir audio base' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Silenciar audio base' })).toBeTruthy();
  });

  it('prevents skipping ahead before the first complete listen', () => {
    const { container } = render(<RoleplayScenario scenario={first} {...shared} />);
    const audio = container.querySelector('audio')!;
    const slider = screen.getByRole('slider', { name: 'Posición del audio base' }) as HTMLInputElement;
    expect(slider.disabled).toBe(true);
    fireEvent.change(slider, { target: { value: '50' } });
    expect(audio.currentTime).toBe(0);
    expect(screen.getByRole('button', { name: /Escucha el audio completo/ }).hasAttribute('disabled')).toBe(true);
  });

  it('allows seeking only after a complete listen and resets the restriction on a new scenario', () => {
    const { container, rerender } = render(<RoleplayScenario scenario={first} {...shared} />);
    const audio = container.querySelector('audio')!;
    fireEvent.ended(audio);
    const slider = screen.getByRole('slider', { name: 'Posición del audio base' }) as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    fireEvent.change(slider, { target: { value: '20' } });
    expect(audio.currentTime).toBe(20);
    rerender(<RoleplayScenario scenario={second} {...shared} />);
    expect((screen.getByRole('slider', { name: 'Posición del audio base' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('requires listening again when audio changes under the same scenario identifier', () => {
    const { container, rerender } = render(<RoleplayScenario scenario={first} {...shared} />);
    fireEvent.ended(container.querySelector('audio')!);
    expect(screen.getByRole('button', { name: /Grabar respuesta/ }).hasAttribute('disabled')).toBe(false);
    rerender(<RoleplayScenario scenario={{ ...first, baseAudioUrl: '/tests/replaced.mp3' }} {...shared} />);
    expect(screen.getByRole('button', { name: /Escucha el audio completo/ }).hasAttribute('disabled')).toBe(true);
    expect((screen.getByRole('slider', { name: 'Posición del audio base' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('clears the previous audio duration until new metadata is loaded', () => {
    const { container, rerender } = render(<RoleplayScenario scenario={first} {...shared} />);
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 60 });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByText('00:00 / 01:00')).toBeTruthy();

    rerender(<RoleplayScenario scenario={{ ...first, baseAudioUrl: '/tests/changed.mp3' }} {...shared} />);
    expect(screen.getByText('00:00 / 00:00')).toBeTruthy();
  });

  it('updates the audio element playbackRate without bypassing the full-listen gate', () => {
    const { container } = render(<RoleplayScenario scenario={first} {...shared} />);
    const audio = container.querySelector('audio')!;
    expect(screen.getByRole('button', { name: /Escucha el audio completo/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Velocidad de reproducción'), { target: { value: '1.25' } });
    expect(audio.playbackRate).toBe(1.25);
    expect(screen.getByRole('button', { name: /Escucha el audio completo/ }).hasAttribute('disabled')).toBe(true);
  });
});
