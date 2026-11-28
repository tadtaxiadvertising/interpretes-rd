/**
 * Role labels are generic editorial metadata, never diarized identities.
 * Recognition must be exact: "Dr. Ana Pérez" and "Patient John Doe" are
 * unknown, not publishable names.
 */
export type StudioSpeakerRole = 'doctor' | 'patient' | 'interpreter' | 'nurse' | 'operator' | 'unknown';
export type StudioLanguage = 'en' | 'es' | 'unknown';

/** Editorial presentation only: do not rewrite persisted professional roles. */
export function studioEditorialProfile(role: StudioSpeakerRole): { role: 'doctor' | 'patient' | 'interpreter'; label: string; language: 'en' | 'es' } | null {
  if (role === 'unknown') return null;
  if (role === 'patient') return { role: 'patient', label: 'Hispanohablante', language: 'es' };
  if (role === 'interpreter') return { role: 'interpreter', label: 'Intérprete original', language: 'en' };
  return { role: 'doctor', label: 'Cliente', language: 'en' };
}

/** Shared explicit profile selection for buttons and focused keyboard review.
 * Preserve a legacy client role when choosing its existing generic profile. */
export function studioProfileSelection(current: StudioSpeakerRole, selected: 'doctor' | 'patient' | 'interpreter'): { speakerRole: StudioSpeakerRole; language: 'en' | 'es' } {
  return {
    speakerRole: selected === 'doctor' && studioEditorialProfile(current)?.role === 'doctor' ? current : selected,
    language: selected === 'patient' ? 'es' : 'en',
  };
}

/** A known language that disagrees with the editorial profile needs review,
 * not automatic correction: the recorded speech may differ from its label. */
export function hasStudioProfileLanguageMismatch(role: StudioSpeakerRole, language: StudioLanguage): boolean {
  const profile = studioEditorialProfile(role);
  return profile !== null && language !== 'unknown' && language !== profile.language;
}

/** A profile name is searchable independently of the title or old role code. */
export function studioProfileSearchText(role: StudioSpeakerRole): string {
  const profile = studioEditorialProfile(role);
  if (!profile) return 'Sin perfil Hablante pendiente';
  return profile.label + (profile.role === 'interpreter' ? ' interprete' : '');
}

const ROLE_LABELS: Record<Exclude<StudioSpeakerRole, 'unknown'>, string> = {
  doctor: 'Doctor',
  patient: 'Paciente',
  interpreter: 'Intérprete',
  nurse: 'Enfermería',
  operator: 'Operador',
};

const SPEAKER_ALIASES: ReadonlyMap<string, { role: StudioSpeakerRole; label: string }> = new Map([
  ['client', { role: 'doctor', label: 'Cliente' }],
  ['cliente', { role: 'doctor', label: 'Cliente' }],
  ['spanish speaker', { role: 'patient', label: 'Hispanohablante' }],
  ['hispanohablante', { role: 'patient', label: 'Hispanohablante' }],
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

/** Only exact generic aliases and explicit EN/ES suffixes. A provider role
 * alone is not evidence of the spoken language. Never parse personal names,
 * speaker numbers, free-form text or ambiguous language descriptions. */
function importedSpeaker(label: string | null): { role: StudioSpeakerRole; label: string | null; language: StudioLanguage } {
  const normalized = label?.trim().toLocaleLowerCase('es') ?? '';
  const unknown = { role: 'unknown', label: null, language: 'unknown' } as const;
  const direct = SPEAKER_ALIASES.get(normalized);
  if (direct) return { ...direct, language: 'unknown' };
  const explicit = /^(.+?)(?:\s*·\s*(en|es)|\s*\((en|es)\))$/.exec(normalized);
  if (!explicit) return unknown;
  const alias = SPEAKER_ALIASES.get(explicit[1].trim());
  const language = explicit[2] ?? explicit[3];
  if (!alias || (language !== 'en' && language !== 'es')) return unknown;
  return { ...alias, language };
}

export function classifySpeakerRole(label: string | null): StudioSpeakerRole {
  return importedSpeaker(label).role;
}

export function safePublishableSpeakerLabel(label: string | null): string | null {
  return importedSpeaker(label).label;
}

/** Imported metadata is provisional; mismatches remain reviewable. */
export function classifyImportedSpeaker(label: string | null): { speakerRole: StudioSpeakerRole; language: StudioLanguage } {
  const { role, language } = importedSpeaker(label);
  return { speakerRole: role, language };
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
    title === `Cliente · ${numbered}` ||
    title === `Hispanohablante · ${numbered}` ||
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
