import { describe, expect, it } from 'vitest';
import { OPENING_CRITERIA, parseOpeningRubric } from './bilingual-opening-rubric';

function completeForm() {
  const form = new FormData();
  for (const { key } of OPENING_CRITERIA) form.set('opening_' + key, 'yes');
  form.set('opening_spanishIntro', 'no');
  form.set('opening_notes', '  Observación  ');
  return form;
}

describe('opening rubric input', () => {
  it('preserves explicit positive and negative results', () => {
    expect(parseOpeningRubric(completeForm())).toEqual({
      englishIntro: true, spanishIntro: false, professionalRole: true,
      consecutiveGuidance: true, clarity: true, notes: 'Observación',
    });
  });
  it('rejects missing, duplicate and unknown criterion values', () => {
    for (const modify of [
      (f: FormData) => f.delete('opening_englishIntro'),
      (f: FormData) => f.append('opening_englishIntro', 'no'),
      (f: FormData) => f.set('opening_englishIntro', 'maybe'),
      (f: FormData) => f.set('opening_notes', 'x'.repeat(2001)),
    ]) {
      const form = completeForm();
      modify(form);
      expect(parseOpeningRubric(form)).toBeNull();
    }
  });
});
