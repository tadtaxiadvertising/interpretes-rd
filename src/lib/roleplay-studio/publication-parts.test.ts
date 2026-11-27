import { describe, expect, it } from 'vitest';
import { planStudioPublicationParts } from './publication-parts';

const turns = (count: number, seconds: number) => Array.from({ length: count }, (_, i) => ({
  id: String(i + 1), start: i * (seconds + 1), end: i * (seconds + 1) + seconds,
}));

describe('non-destructive Studio publication parts', () => {
  it('partitions 100 chronological turns without loss or mutation', () => {
    const input = turns(100, 10).reverse();
    const before = JSON.stringify(input);
    const plan = planStudioPublicationParts(input, 2000);
    expect(plan.issue).toBeNull();
    expect(plan.parts.map(part => [part.first, part.last, part.turns.length])).toEqual([
      [1, 25, 25], [26, 50, 25], [51, 75, 25], [76, 100, 25],
    ]);
    expect(plan.parts.flatMap(part => part.turns).map(turn => turn.id)).toEqual(turns(100, 10).map(turn => turn.id));
    expect(JSON.stringify(input)).toBe(before);
  });

  it('respects the 900-second budget and accepts an exact boundary', () => {
    const plan = planStudioPublicationParts(turns(10, 300), 4000);
    expect(plan.parts.map(part => part.seconds)).toEqual([900, 900, 900, 300]);
    expect(plan.parts.flatMap(part => part.turns)).toHaveLength(10);
  });

  it('counts compound audio without counting the removed gap', () => {
    const compound = { id: 'joined', start: 0, end: 2000,
      ranges: [{ start: 0, end: 100 }, { start: 1900, end: 2000 }] };
    const plan = planStudioPublicationParts([compound, { id: 'next', start: 2000, end: 2010 }], 2100);
    expect(plan.issue).toBeNull();
    expect(plan.parts[0].seconds).toBe(210);
    expect(plan.parts[0].turns).toHaveLength(2);
  });

  it('fails explicitly on invalid or overlapping cuts instead of silently dropping them', () => {
    const input = turns(3, 10);
    expect(planStudioPublicationParts([input[0], { ...input[1], start: 5 }], 100).issue).toContain('intervención 2');
    expect(planStudioPublicationParts([{ ...input[0], end: 500 }], 600).parts).toEqual([]);
  });

  it('changes selection identity when membership changes', () => {
    const input = turns(30, 10);
    const a = planStudioPublicationParts(input, 1000).parts[0];
    const b = planStudioPublicationParts(input.slice(1), 1000).parts[0];
    expect(a.key).not.toBe(b.key);
    expect(planStudioPublicationParts(input, 1000).parts[0].key).toBe(a.key);
  });
});
