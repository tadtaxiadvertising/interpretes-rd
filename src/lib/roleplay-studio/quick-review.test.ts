import { describe, expect, it } from 'vitest';
import { studioReviewIssue, nextUnconfirmedTurn } from './quick-review';

const a = { id: 'a', title: 'Doctor', start: 0, end: 5, scriptPrompt: '', responseLimit: 120,
  speakerRole: 'doctor' as const, language: 'en' as const };
const b = { ...a, id: 'b', start: 5, end: 10 };
describe('explicit Studio review', () => {
  it('accepts adjacent valid cuts and rejects unresolved editorial issues', () => {
    expect(studioReviewIssue(a, [a, b], 20)).toBeNull();
    expect(studioReviewIssue({ ...a, speakerRole: 'interpreter' }, [a,b], 20)).toContain('intérprete');
    expect(studioReviewIssue({ ...a, speakerRole: 'unknown' }, [a,b], 20)).toContain('hablante');
    expect(studioReviewIssue({ ...a, language: 'unknown' }, [a,b], 20)).toContain('idioma');
    expect(studioReviewIssue({ ...a, title: '' }, [a,b], 20)).toContain('título');
    expect(studioReviewIssue({ ...a, end: 6 }, [a,b], 20)).toContain('solapamiento');
    expect(studioReviewIssue({ ...a, start: -1 }, [a,b], 20)).toContain('límites');
    expect(studioReviewIssue({ ...a, responseLimit: 301 }, [a,b], 20)).toContain('respuesta');
  });
  it('skips confirmed turns, wraps once and stops when the visible queue is complete', () => {
    const c = { ...b, id: 'c' };
    expect(nextUnconfirmedTurn([a,b,c], 'a', new Set(['a','b']))?.id).toBe('c');
    expect(nextUnconfirmedTurn([a,b,c], 'c', new Set(['b','c']))?.id).toBe('a');
    expect(nextUnconfirmedTurn([a,b,c], 'a', new Set(['a','b','c']))).toBeUndefined();
    expect(nextUnconfirmedTurn([b], 'b', new Set(['b']))).toBeUndefined();
  });
});
