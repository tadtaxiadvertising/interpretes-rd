/**
 * Role labels are generic editorial metadata, never diarized identities.
 * Recognition must be exact: "Dr. Ana Pérez" and "Patient John Doe" are
 * unknown, not publishable names.
 */
export type StudioSpeakerRole = 'doctor' | 'patient' | 'interpreter' | 'nurse' | 'operator' | 'unknown';
export type StudioLanguage = 'en' | 'es' | 'unknown';

const ROLE_LABELS: Record<Exclude<StudioSpeakerRole, 'unknown'>, string> = {
  doctor: 'Doctor',
  patient: 'Paciente',
  interpreter: 'Intérprete',
  nurse: 'Enfermería',
  operator: 'Operador',
};

const SPEAKER_ALIASES: ReadonlyMap<string, { role: StudioSpeakerRole; label: string }> = new Map([
  ['doctor', { role: 'doctor', label: 'Doctor' }],
  ['dr', { role: 'doctor', label: 'Doctor' }],
  ['dr.', { role: 'doctor', label: 'Doctor' }],
  ['médico', { role: 'doctor', label: 'Médico' }],
  ['medico', { role: 'doctor', label: 'Médico' }],
  ['physician', { role: 'doctor', label: 'Médico' }],
  ['patient', { role: 'patient', label: 'Paciente' }],
  ['paciente', { role: 'patient', label: 'Paciente' }],
  ['nurse', { role: 'nurse', label: 'Enfermería' }],
  ['enfermero', { role: 'nurse', label: 'Enfermería' }],
  ['enfermera', { role: 'nurse', label: 'Enfermería' }],
  ['interpreter', { role: 'interpreter', label: 'Intérprete' }],
  ['intérprete', { role: 'interpreter', label: 'Intérprete' }],
  ['interprete', { role: 'interpreter', label: 'Intérprete' }],
  ['operator', { role: 'operator', label: 'Operador' }],
  ['operador', { role: 'operator', label: 'Operador' }],
]);

export function classifySpeakerRole(label: string | null): StudioSpeakerRole {
  if (!label) return 'unknown';
  return SPEAKER_ALIASES.get(label.trim().toLocaleLowerCase('es'))?.role ?? 'unknown';
}

export function safePublishableSpeakerLabel(label: string | null): string | null {
  if (!label) return null;
  return SPEAKER_ALIASES.get(label.trim().toLocaleLowerCase('es'))?.label ?? null;
}

export function makeNeutralSegmentTitle(
  role: StudioSpeakerRole, language: StudioLanguage, index: number,
): string {
  const label = role === 'unknown' ? 'Intervención' : ROLE_LABELS[role];
  const languageSuffix = language === 'unknown' ? '' : ` (${language.toUpperCase()})`;
  return `${label} · ${index + 1}${languageSuffix}`;
}

/**
 * Retitle generated clips as soon as the editor chooses a speaker/language.
 * Keep all freeform titles intact; in particular, never derive titles from
 * source transcript content or personal names.
 */
export function titleAfterProfileChange(
  title: string,
  previousRole: StudioSpeakerRole,
  previousLanguage: StudioLanguage,
  index: number,
  nextRole: StudioSpeakerRole,
  nextLanguage: StudioLanguage,
): string {
  const numbered = index + 1;
  const recognizedDefault =
    title === makeNeutralSegmentTitle(previousRole, previousLanguage, index) ||
    title === `Intervención ${numbered}` ||
    title === `Intervención sugerida ${numbered}` ||
    title === `Médico · ${numbered}` ||
    title === `Doctor · ${numbered}` ||
    title === `Paciente · ${numbered}` ||
    title === `Enfermería · ${numbered}` ||
    title === `Operador · ${numbered}` ||
    title === `Intérprete · ${numbered}` ||
    /^Corte (?:\d{2}:)?\d{2}:\d{2}\.\d$/.test(title);
  return recognizedDefault
    ? makeNeutralSegmentTitle(nextRole, nextLanguage, index)
    : title;
}

export function filterInterpreterCues<T extends { speaker: string | null }>(
  cues: readonly T[], excludeInterpreter: boolean,
): { selected: T[]; excludedCount: number } {
  if (!excludeInterpreter) return { selected: [...cues], excludedCount: 0 };
  const selected = cues.filter(cue => classifySpeakerRole(cue.speaker) !== 'interpreter');
  return { selected, excludedCount: cues.length - selected.length };
}
