import { describe, expect, it } from 'vitest';
import { proposeStudioBoundaries } from './boundary-proposals';

const active = { id: 'a', start: 5, end: 10 };
describe('conservative boundary proposals', () => {
  it('offers a small edge trim without modifying the active or neighboring cuts', () => {
    const other = { id: 'b', start: 9.8, end: 15 };
    const cuts = [active, other];
    const before = JSON.stringify(cuts);
    expect(proposeStudioBoundaries(active, cuts, 20)).toEqual({ start: 5, end: 9.8, reason: 'overlap' });
    expect(JSON.stringify(cuts)).toBe(before);
    expect(proposeStudioBoundaries(active, [active, { ...other, start: 10 }], 20)).toBeNull();
  });
  it('rejects long overlaps, containment, compound cuts and excessively short results', () => {
    expect(proposeStudioBoundaries(active, [active, { id: 'b', start: 8, end: 15 }], 20)).toBeNull();
    expect(proposeStudioBoundaries(active, [active, { id: 'b', start: 6, end: 8 }], 20)).toBeNull();
    expect(proposeStudioBoundaries({ ...active, ranges: [{ start: 5, end: 6 }, { start: 9, end: 10 }] }, [active], 20)).toBeNull();
    const short = { id: 'a', start: 5, end: 5.6 };
    expect(proposeStudioBoundaries(short, [short, { id: 'b', start: 5.2, end: 8 }], 20)).toBeNull();
  });
  it('trims only detected edge silence, keeps a margin and caps the change', () => {
    const proposal = proposeStudioBoundaries(active, [active], 20, [
      { start: 4, end: 5.8 }, { start: 9.2, end: 11 },
    ]);
    expect(proposal?.reason).toBe('silence');
    expect(proposal?.start).toBeCloseTo(5.6);
    expect(proposal?.end).toBeCloseTo(9.4);
    expect(proposeStudioBoundaries(active, [active], 20, [{ start: 0, end: 8 }])?.start).toBe(6.5);
    expect(proposeStudioBoundaries(active, [active], 20, [{ start: 6, end: 8 }])).toBeNull();
    expect(proposeStudioBoundaries(active, [active], 20, [{ start: 0, end: 20 }])).toBeNull();
  });
});
