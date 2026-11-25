export const OPENING_CRITERIA = [
  { key: 'englishIntro', label: 'Identificación profesional y presentación ante el médico en inglés.' },
  { key: 'spanishIntro', label: 'Presentación equivalente ante el paciente en español.' },
  { key: 'professionalRole', label: 'Explicación del papel del intérprete, imparcialidad y confidencialidad.' },
  { key: 'consecutiveGuidance', label: 'Indicación de cómo comunicarse durante la interpretación consecutiva.' },
  { key: 'clarity', label: 'Claridad, registro profesional y coherencia entre ambas presentaciones.' },
] as const;

export type OpeningCriterion = typeof OPENING_CRITERIA[number]['key'];
export type OpeningRubric = Record<OpeningCriterion, boolean> & { notes: string };

export function parseOpeningRubric(form: FormData): OpeningRubric | null {
  const values = OPENING_CRITERIA.map(({ key }) => form.getAll('opening_' + key));
  if (values.some(value => value.length !== 1 || !['yes', 'no'].includes(String(value[0])))) return null;
  const notes = form.getAll('opening_notes');
  if (notes.length > 1 || (notes.length && (typeof notes[0] !== 'string' || notes[0].length > 2000))) return null;
  return {
    englishIntro: values[0][0] === 'yes', spanishIntro: values[1][0] === 'yes',
    professionalRole: values[2][0] === 'yes', consecutiveGuidance: values[3][0] === 'yes',
    clarity: values[4][0] === 'yes', notes: typeof notes[0] === 'string' ? notes[0].trim() : '',
  };
}
