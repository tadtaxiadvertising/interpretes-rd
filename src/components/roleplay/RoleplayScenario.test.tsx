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

  it('updates the audio element playbackRate without bypassing the full-listen gate', () => {
    const { container } = render(<RoleplayScenario scenario={first} {...shared} />);
    const audio = container.querySelector('audio')!;
    expect(screen.getByRole('button', { name: /Escucha el audio completo/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Velocidad de reproducción'), { target: { value: '1.25' } });
    expect(audio.playbackRate).toBe(1.25);
    expect(screen.getByRole('button', { name: /Escucha el audio completo/ }).hasAttribute('disabled')).toBe(true);
  });
});
