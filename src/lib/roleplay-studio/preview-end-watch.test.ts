import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchPreviewEnd } from './preview-end-watch';

const clock = () => ({ currentTime: 1, playbackRate: 1, paused: false, seeking: false });

describe('bounded media-time preview monitor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('stops a short preview at the media endpoint exactly once', () => {
    const media = clock();
    const onEnd = vi.fn();
    watchPreviewEnd(media, 1.05, () => true, onEnd);
    vi.advanceTimersByTime(15);
    expect(onEnd).not.toHaveBeenCalled();
    media.currentTime = 1.05;
    vi.advanceTimersByTime(100);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not stop on elapsed wall time when media is paused or stalled', () => {
    const media = clock();
    const onEnd = vi.fn();
    const cancel = watchPreviewEnd(media, 1.1, () => true, onEnd);
    media.paused = true;
    vi.advanceTimersByTime(1000);
    media.paused = false;
    vi.advanceTimersByTime(1000);
    expect(onEnd).not.toHaveBeenCalled();
    cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for a seek to finish before enforcing the endpoint', () => {
    const media = clock();
    media.seeking = true;
    media.currentTime = 2;
    const onEnd = vi.fn();
    watchPreviewEnd(media, 1.1, () => true, onEnd);
    vi.advanceTimersByTime(250);
    expect(onEnd).not.toHaveBeenCalled();
    media.seeking = false;
    vi.advanceTimersByTime(100);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('checks changed playback speed using the current media clock', () => {
    const media = clock();
    const onEnd = vi.fn();
    watchPreviewEnd(media, 1.1, () => true, onEnd);
    vi.advanceTimersByTime(15);
    media.playbackRate = 2;
    media.currentTime = 1.08;
    vi.advanceTimersByTime(100);
    expect(onEnd).not.toHaveBeenCalled();
    media.currentTime = 1.1;
    vi.advanceTimersByTime(100);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not stop a replacement preview or leave a stale timer', () => {
    const media = clock();
    let current = true;
    const onEnd = vi.fn();
    watchPreviewEnd(media, 1.1, () => current, onEnd);
    current = false;
    media.currentTime = 2;
    vi.advanceTimersByTime(100);
    expect(onEnd).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels explicitly and ignores invalid endpoints', () => {
    const media = clock();
    const onEnd = vi.fn();
    const cancel = watchPreviewEnd(media, 1.1, () => true, onEnd);
    cancel();
    cancel();
    for (const end of [0, -1, NaN, Infinity]) watchPreviewEnd(media, end, () => true, onEnd);
    media.currentTime = 2;
    vi.advanceTimersByTime(1000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
