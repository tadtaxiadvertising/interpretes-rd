import { describe, expect, it } from 'vitest';
import {
  classifySpeakerRole,
  filterInterpreterCues,
  makeNeutralSegmentTitle,
  titleAfterProfileChange,
  safePublishableSpeakerLabel,
  studioEditorialProfile,
  studioProfileSelection,
  studioProfileSearchText,
} from './speaker-profiles';

describe('Studio three-party speaker review with bilingual role labels', () => {
  it.each([
    ['doctor', 'doctor', 'Cliente', 'en'],
    ['nurse', 'doctor', 'Cliente', 'en'],
    ['operator', 'doctor', 'Cliente', 'en'],
    ['patient', 'patient', 'Hispanohablante', 'es'],
    ['interpreter', 'interpreter', 'Intérprete original', 'en'],
  ] as const)('presents legacy %s under its generic editorial profile', (role, expected, label, language) => {
    expect(studioEditorialProfile(role)).toEqual({ role: expected, label, language });
    expect(studioProfileSearchText(role)).toContain(label);
  });

  it('preserves legacy client identifiers and applies all three explicit language profiles', () => {
    expect(studioProfileSelection('nurse', 'doctor')).toEqual({ speakerRole: 'nurse', language: 'en' });
    expect(studioProfileSelection('operator', 'doctor')).toEqual({ speakerRole: 'operator', language: 'en' });
    expect(studioProfileSelection('unknown', 'doctor')).toEqual({ speakerRole: 'doctor', language: 'en' });
    expect(studioProfileSelection('doctor', 'patient')).toEqual({ speakerRole: 'patient', language: 'es' });
    expect(studioProfileSelection('patient', 'interpreter')).toEqual({ speakerRole: 'interpreter', language: 'en' });
  });

  it('leaves unknown roles pending without inferring a profile', () => {
    expect(studioEditorialProfile('unknown')).toBeNull();
    expect(studioProfileSearchText('unknown')).toContain('Sin perfil');
  });

  it('recognizes only exact generic professional roles, never real names', () => {
    expect(classifySpeakerRole('Doctor')).toBe('doctor');
    expect(classifySpeakerRole('Médico')).toBe('doctor');
    expect(classifySpeakerRole(' Patient ')).toBe('patient');
    expect(classifySpeakerRole('Intérprete')).toBe('interpreter');
    expect(classifySpeakerRole('INTERPRETER')).toBe('interpreter');
    expect(classifySpeakerRole('Nurse')).toBe('nurse');
    expect(classifySpeakerRole('Operator')).toBe('operator');
    expect(classifySpeakerRole('Dr. Ana Pérez')).toBe('unknown');
    expect(classifySpeakerRole('Patient John Doe')).toBe('unknown');
    expect(classifySpeakerRole('__proto__')).toBe('unknown');
    expect(classifySpeakerRole(null)).toBe('unknown');

    expect(safePublishableSpeakerLabel('Medico')).toBe('Médico');
    expect(safePublishableSpeakerLabel('Dr. Ana Pérez')).toBeNull();
  });

  it('recognizes the generic Audio Studio profile labels without identifying names', () => {
    expect(classifySpeakerRole(' Cliente ')).toBe('doctor');
    expect(classifySpeakerRole('Client')).toBe('doctor');
    expect(classifySpeakerRole('Hispanohablante')).toBe('patient');
    expect(classifySpeakerRole('Spanish speaker')).toBe('patient');
    expect(classifySpeakerRole('Cliente Juan')).toBe('unknown');
    expect(safePublishableSpeakerLabel('Cliente Juan')).toBeNull();
    expect(safePublishableSpeakerLabel('Spanish speaker')).toBe('Hispanohablante');
  });

  it('selects bilingual dialogue while omitting only the original interpreter', () => {
    const cues = [
      { speaker: 'Doctor', start: 1, end: 2, text: 'Private English medical dialogue' },
      { speaker: 'Interpreter', start: 2, end: 3, text: 'Original rendition' },
      { speaker: 'Paciente', start: 3, end: 4, text: 'Texto privado en español' },
      { speaker: 'Dr. Ana Pérez', start: 4, end: 5, text: 'Unknown: needs manual review' },
    ];

    const { selected, excludedCount } = filterInterpreterCues(cues, true);
    expect(excludedCount).toBe(1);
    expect(selected.map(cue => cue.speaker)).toEqual(['Doctor', 'Paciente', 'Dr. Ana Pérez']);
    expect(filterInterpreterCues(cues, false).selected).toHaveLength(4);
    // Important: never infer an interpreter from a non-generic personal label.
    expect(selected[2].text).toContain('needs manual review');
  });

  it('automatically updates generated titles without overwriting editorial titles', () => {
    expect(titleAfterProfileChange('Intervención 1', 'unknown', 'unknown', 0, 'doctor', 'en'))
      .toBe('Doctor · 1 (EN)');
    expect(titleAfterProfileChange('Doctor · 1 (EN)', 'doctor', 'en', 0, 'patient', 'es'))
      .toBe('Paciente · 1 (ES)');
    expect(titleAfterProfileChange('Médico · 1', 'doctor', 'unknown', 0, 'doctor', 'es'))
      .toBe('Doctor · 1 (ES)');
    expect(titleAfterProfileChange('Intervención sugerida 3', 'unknown', 'unknown', 2, 'nurse', 'es'))
      .toBe('Enfermería · 3 (ES)');
    expect(titleAfterProfileChange('Corte 00:10.0', 'unknown', 'unknown', 0, 'doctor', 'en'))
      .toBe('Doctor · 1 (EN)');
    expect(titleAfterProfileChange('Evaluación médica', 'doctor', 'en', 0, 'patient', 'es'))
      .toBe('Evaluación médica');
    expect(titleAfterProfileChange('Dr. Ana Pérez', 'unknown', 'unknown', 0, 'doctor', 'en'))
      .toBe('Dr. Ana Pérez');
  });

  it('creates non-identifying titles without including the transcript', () => {
    expect(makeNeutralSegmentTitle('doctor', 'en', 0)).toBe('Doctor · 1 (EN)');
    expect(makeNeutralSegmentTitle('patient', 'es', 1)).toBe('Paciente · 2 (ES)');
    expect(makeNeutralSegmentTitle('unknown', 'unknown', 2)).toBe('Intervención · 3');
    expect(makeNeutralSegmentTitle('interpreter', 'es', 3)).toBe('Intérprete · 4 (ES)');
  });
});
