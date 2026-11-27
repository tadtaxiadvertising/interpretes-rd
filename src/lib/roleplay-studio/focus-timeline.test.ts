import { describe, expect, it } from 'vitest';
import { studioTimelineWindow, studioTimelineGeometry } from './focus-timeline';

describe('focused timeline geometry', () => {
  it('bounds zoom windows at both source edges and on long recordings', () => {
    expect(studioTimelineWindow(120, 0, 30)).toEqual({ start: 0, end: 30 });
    expect(studioTimelineWindow(120, 120, 30)).toEqual({ start: 90, end: 120 });
    expect(studioTimelineWindow(43200, 10000, 120)).toEqual({ start: 9940, end: 10060 });
    expect(studioTimelineWindow(5, 4, 30)).toEqual({ start: 0, end: 5 });
  });
  it('clips visible geometry without changing original boundaries', () => {
    const window = { start: 10, end: 20 };
    const cut = { id: 'a', start: 5, end: 15 };
    expect(studioTimelineGeometry(cut, window)).toEqual({ left: 0, width: 50 });
    expect(studioTimelineGeometry({ id: 'b', start: 18, end: 25 }, window)).toEqual({ left: 80, width: 20 });
    expect(studioTimelineGeometry({ id: 'c', start: 0, end: 10 }, window)).toBeNull();
    expect(studioTimelineGeometry({ id: 'd', start: 12, end: 11 }, window)).toBeNull();
    expect(cut).toEqual({ id: 'a', start: 5, end: 15 });
  });
});
