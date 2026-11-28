import { describe, expect, it } from 'vitest';
import { sourceSpeakerGroup, propagateSpeakerProfile, summarizeSourceSpeakerGroups } from './speaker-groups';
import { createStudioDraft } from './draft';
import type { StudioDraftSegment } from './draft';

type Turn = StudioDraftSegment & { id: string; sourceSpeakerGroup?: string };
const turn = (n: number, overrides: Partial<Turn> = {}): Turn => ({
  id: String(n), title: `Intervención ${n}`, start: (n - 1) * 5, end: (n - 1) * 5 + 4,
  scriptPrompt: '', responseLimit: 120, speakerRole: 'unknown', language: 'unknown',
  sourceSpeakerGroup: 'speaker 1', ...overrides,
});

describe('source speaker grouping', () => {
  it('only recognizes explicit numbered labels, never names or generic roles', () => {
    expect(sourceSpeakerGroup('Speaker 1')).toBe('speaker 1');
    expect(sourceSpeakerGroup('SPEAKER_1')).toBe('speaker 1');
    expect(sourceSpeakerGroup('Hablante 2')).toBe('hablante 2');
    for (const label of [null, 'Doctor', 'Patient John Doe', 'Speaker 1 Jane Doe', 'Speaker']) {
      expect(sourceSpeakerGroup(label)).toBeUndefined();
    }
  });

  it('fills pending fields only within the chosen group and preserves custom titles', () => {
    const input = [turn(1, { speakerRole: 'doctor', language: 'en' }),
      turn(2), turn(3, { sourceSpeakerGroup: 'speaker 2' }),
      turn(4, { speakerRole: 'patient' }), turn(5, { language: 'es', title: 'Custom' }),
      turn(6, { speakerRole: 'interpreter' }), turn(7, { sourceSpeakerGroup: undefined })];
    const snapshot = JSON.stringify(input);
    const result = propagateSpeakerProfile(input, '1');
    expect(result.changed).toBe(1);
    expect(result.turns[1]).toMatchObject({ speakerRole: 'doctor', language: 'en', title: 'Doctor · 2 (EN)' });
    expect(result.turns[4]).toEqual(input[4]);
    for (const i of [0, 2, 3, 4, 5, 6]) expect(result.turns[i]).toEqual(input[i]);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(JSON.stringify(createStudioDraft(1500, 'ab'.repeat(32), result.turns, 90))).not.toContain('sourceSpeakerGroup');
  });

  it('protects confirmed and hidden turns and requires a compatible active profile', () => {
    const input = [turn(1, { speakerRole: 'doctor', language: 'en' }), turn(2),
      turn(3), turn(4, { language: 'en', title: 'Custom' }), turn(5, { language: 'es' })];
    const result = propagateSpeakerProfile(input, '1', { visibleIds: new Set(['1','2','4','5']), protectedIds: new Set(['2']) });
    expect(result.changed).toBe(1);
    expect(result.turns[3]).toMatchObject({ speakerRole: 'doctor', language: 'en', title: 'Custom' });
    for (const i of [0,1,2,4]) expect(result.turns[i]).toBe(input[i]);
    expect(propagateSpeakerProfile([turn(1,{speakerRole:'doctor',language:'unknown'}),turn(2)],'1').changed).toBe(0);
    expect(propagateSpeakerProfile([turn(1,{speakerRole:'doctor',language:'es'}),turn(2)],'1').changed).toBe(0);
    expect(propagateSpeakerProfile(input,'1',{visibleIds:new Set(['2'])}).changed).toBe(0);
  });

  it('summarizes numbered voice groups independently and excludes personal labels', () => {
    expect(summarizeSourceSpeakerGroups([turn(1),turn(2,{speakerRole:'doctor',language:'en'}),
      turn(3,{sourceSpeakerGroup:'speaker 10'}),turn(4,{sourceSpeakerGroup:'speaker 2',speakerRole:'patient',language:'en'}),
      turn(5,{sourceSpeakerGroup:'Jane Doe'})])).toEqual([
      {id:'speaker 1',count:2,pending:1},{id:'speaker 2',count:1,pending:1},{id:'speaker 10',count:1,pending:1},
    ]);
  });

  it('does not propagate unclassified or interpreter profiles', () => {
    const input = [turn(1, { speakerRole: 'interpreter' }), turn(2)];
    expect(propagateSpeakerProfile(input, '1').changed).toBe(0);
    expect(propagateSpeakerProfile(input, '2').changed).toBe(0);
  });
});
