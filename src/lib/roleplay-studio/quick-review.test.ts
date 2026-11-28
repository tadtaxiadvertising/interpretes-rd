import { describe, expect, it } from 'vitest';
import { studioReviewIssue, nextUnconfirmedTurn, inspectStudioReview } from './quick-review';

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
  it.each([
    ['doctor', 'es', 'Cliente (EN)'],
    ['nurse', 'es', 'Cliente (EN)'],
    ['operator', 'es', 'Cliente (EN)'],
    ['patient', 'en', 'Hispanohablante (ES)'],
  ] as const)('flags an incompatible %s/%s without rewriting its metadata', (speakerRole, language, label) => {
    const turn = { ...a, speakerRole, language };
    const before = JSON.stringify(turn);
    const report = inspectStudioReview([turn], 20);
    expect(report[0].findings).toEqual([{ code: 'language', message: 'El idioma no coincide con ' + label + '. Escucha y revisa el perfil.' }]);
    expect(studioReviewIssue(turn, [turn], 20)).toContain(label);
    expect(JSON.stringify(turn)).toBe(before);
    expect(studioReviewIssue({ ...turn, language: speakerRole === 'patient' ? 'es' : 'en' }, [turn], 20)).toBeNull();
  });
  it('preserves original-interpreter exclusion ahead of language review', () => {
    const turn = { ...a, speakerRole: 'interpreter' as const, language: 'es' as const };
    expect(inspectStudioReview([turn], 20)[0].findings.map(issue => issue.code)).toEqual(['interpreter']);
  });
  it('reports all issues per turn in chronological order without mutating the project', () => {
    const incomplete = { ...a, speakerRole: 'unknown' as const, language: 'unknown' as const, title: '', end: 6 };
    const input = [b, incomplete];
    const before = JSON.stringify(input);
    const report = inspectStudioReview(input, 20);
    expect(report.map(item => item.turn.id)).toEqual(['a','b']);
    expect(report[0].findings.map(issue => issue.code)).toEqual(['speaker','language','title','overlap']);
    expect(report[1].findings.map(issue => issue.code)).toEqual(['overlap']);
    expect(studioReviewIssue(incomplete, input, 20)).toBe(report[0].findings[0].message);
    expect(JSON.stringify(input)).toBe(before);
    expect(inspectStudioReview([a,b], 20).every(item => item.findings.length === 0)).toBe(true);
  });
  it('skips confirmed turns, wraps once and stops when the visible queue is complete', () => {
    const c = { ...b, id: 'c' };
    expect(nextUnconfirmedTurn([a,b,c], 'a', new Set(['a','b']))?.id).toBe('c');
    expect(nextUnconfirmedTurn([a,b,c], 'c', new Set(['b','c']))?.id).toBe('a');
    expect(nextUnconfirmedTurn([a,b,c], 'a', new Set(['a','b','c']))).toBeUndefined();
    expect(nextUnconfirmedTurn([b], 'b', new Set(['b']))).toBeUndefined();
  });
});
