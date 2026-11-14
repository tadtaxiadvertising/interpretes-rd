import { describe, expect, it } from 'vitest';
import { buildConsecutivePreviewPlan, consecutivePracticePause } from './consecutive-preview';

const turns = [
  { id: '2', title: 'Paciente', start: 5, end: 8, speakerRole: 'patient' },
  { id: '1', title: 'Doctor', start: 0, end: 4, speakerRole: 'doctor' },
  { id: '3', title: 'Intérprete anterior', start: 8, end: 10, speakerRole: 'interpreter' },
];

describe('studio consecutive editor preview plan', () => {
  it('orders real speakers and excludes the original interpreter without modifying inputs', () => {
    const plan = buildConsecutivePreviewPlan(turns, 20);
    expect(plan.turns.map(t => t.id)).toEqual(['1', '2']);
    expect(plan.excludedInterpreterCount).toBe(1);
    expect(plan.totalAudioSeconds).toBe(7);
    expect(plan.turns.map(t => t.duration)).toEqual([4, 3]);
    expect(turns[0].id).toBe('2');
  });

  it('uses the source simulator pause formula and constrains controls', () => {
    expect(consecutivePracticePause(4, 1.2, 3)).toBeCloseTo(7.8);
    expect(() => consecutivePracticePause(4, 0, 3)).toThrow(/rango/);
    expect(() => consecutivePracticePause(4, 1, 31)).toThrow(/rango/);
    expect(() => consecutivePracticePause(NaN, 1.2, 3)).toThrow(/rango/);
  });

  it('rejects overlapping, invalid and unbounded audio cuts', () => {
    expect(() => buildConsecutivePreviewPlan([
      { id: 'a', title: 'First', start: 0, end: 4, speakerRole: 'patient' },
      { id: 'b', title: 'Second', start: 3, end: 6, speakerRole: 'doctor' },
    ], 20)).toThrow(/solapados/);
    expect(() => buildConsecutivePreviewPlan([{ ...turns[0], end: 22 }], 20)).toThrow(/tiempos/);
    expect(() => buildConsecutivePreviewPlan([{ ...turns[0], start: NaN }], 20)).toThrow(/tiempos/);
    expect(() => buildConsecutivePreviewPlan([{ ...turns[0], title: '' }], 20)).toThrow(/título/);
    expect(() => buildConsecutivePreviewPlan([{ ...turns[0], end: 306 }], 400)).toThrow(/tiempos/);
  });

  it('rejects previews with no publishable speakers, too many clips or too much audio', () => {
    expect(() => buildConsecutivePreviewPlan(turns.slice(2), 20)).toThrow(/intérprete original/);
    expect(() => buildConsecutivePreviewPlan([], 20)).toThrow(/entre 1 y 25/);
    expect(() => buildConsecutivePreviewPlan([
      { id: 'one', title: 'A', start: 0, end: 300, speakerRole: 'patient' },
      { id: 'two', title: 'B', start: 300, end: 600, speakerRole: 'doctor' },
      { id: 'three', title: 'C', start: 600, end: 900, speakerRole: 'patient' },
      { id: 'four', title: 'D', start: 900, end: 901, speakerRole: 'doctor' },
    ], 1000)).toThrow(/15 minutos/);
    expect(() => buildConsecutivePreviewPlan(turns, 9000)).toThrow(/MP3 válido/);
  });
});
