import { describe, expect, it } from 'vitest';
import { restoreExcludedIssue } from './editorial-trash';
import { createStudioRecovery, openStudioRecovery } from './recovery';

const turn = { id: 'excluded', start: 5, end: 10, title: 'Paciente', scriptPrompt: '', responseLimit: 120,
  speakerRole: 'patient' as const, language: 'es' as const };
const adjacent = { ...turn, id: 'active', start: 10, end: 15 };
describe('editorial trash', () => {
  it('restores adjacent cuts but rejects overlaps, duplicates, capacity and invalid times', () => {
    expect(restoreExcludedIssue(turn, [adjacent], 20, 25)).toBeNull();
    expect(restoreExcludedIssue(turn, [{ ...adjacent, start: 9 }], 20, 25)).toContain('solapa');
    expect(restoreExcludedIssue(turn, [turn], 20, 25)).toContain('ya está');
    expect(restoreExcludedIssue(turn, [adjacent], 20, 1)).toContain('espacio');
    expect(restoreExcludedIssue({ ...turn, end: 22 }, [adjacent], 20, 25)).toContain('inválidos');
  });

  it('persists excluded metadata separately without private references or publication leakage', () => {
    const hash = 'ab'.repeat(32);
    const privateTurn = { ...turn, caption: 'Private transcript', sourceSpeakerGroup: 'speaker 1' };
    const raw = createStudioRecovery(300, hash, 20, [adjacent], new Set(), 'active', 12, [privateTurn]);
    const restored = openStudioRecovery(raw, 300, hash, 20);
    expect(restored.segments).toHaveLength(1);
    expect(restored.excluded).toHaveLength(1);
    expect(restored.excluded[0]).toMatchObject({ start: 5, end: 10, title: 'Paciente' });
    expect(raw).not.toContain('Private transcript');
    expect(raw).not.toContain('sourceSpeakerGroup');
    const old = createStudioRecovery(300, hash, 20, [adjacent], new Set(), 'active', 12);
    expect(openStudioRecovery(old, 300, hash, 20).excluded).toEqual([]);
    const malformed = JSON.parse(raw);
    malformed.excluded.sourceSampleSha256 = 'cd'.repeat(32);
    expect(() => openStudioRecovery(JSON.stringify(malformed), 300, hash, 20)).toThrow();
  });
});
