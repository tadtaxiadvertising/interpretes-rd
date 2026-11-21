import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import type { TimedTranscriptCue } from './transcript';
import { classifySpeakerRole } from './speaker-profiles';

const MAX_PACKAGE_AUDIO_SECONDS = 900;

/**
 * Only an explicit, ordered selection can become the 25-scene roleplay.
 * A long/overlapping subtitle timeline is reference material, not a license to
 * export hundreds of clips or overlapping turns.
 */
export function selectTimedCues(
  available: readonly TimedTranscriptCue[], chosenIndices: readonly number[],
): TimedTranscriptCue[] {
  if (chosenIndices.length < 1 || chosenIndices.length > ROLEPLAY_MAX_SCENARIOS) {
    throw new Error(`Selecciona entre 1 y ${ROLEPLAY_MAX_SCENARIOS} intervenciones.`);
  }
  const unique = new Set(chosenIndices);
  if (unique.size !== chosenIndices.length) {
    throw new Error('Una misma intervención no puede seleccionarse dos veces.');
  }
  const sorted = [...chosenIndices].sort((a, b) => a - b);
  const selected: TimedTranscriptCue[] = [];
  let lastEnd = 0;
  let total = 0;

  for (const index of sorted) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= available.length) {
      throw new Error('Hay una intervención inexistente en la selección.');
    }
    const cue = available[index];
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) ||
        cue.start < lastEnd || cue.end <= cue.start || cue.end - cue.start > 300) {
      throw new Error('La selección contiene intervenciones solapadas o tiempos inválidos.');
    }
    total += cue.end - cue.start;
    if (total > MAX_PACKAGE_AUDIO_SECONDS) {
      throw new Error('La selección excede los 15 minutos máximos de audio del paquete.');
    }
    lastEnd = cue.end;
    selected.push(cue);
  }
  return selected;
}

/**
 * Fill a manual review selection with non-overlapping cues from the visible
 * SRT/VTT candidates, without replacing any existing selection. Every added
 * cue must pass the same 25-turn / 15-minute rules used at export.
 *
 * This is a suggestion, not speaker diarization. Never automatically pick a
 * cue explicitly labeled as the original interpreter; an administrator may
 * still inspect and manually select it, but export will reject it.
 */
export function fillCompatibleTimedCueSelection(
  available: readonly TimedTranscriptCue[],
  chosenIndices: readonly number[],
  candidateIndices: readonly number[],
): number[] {
  // A malformed manual selection must be corrected explicitly, not silently
  // thrown away or turned into an apparently valid different selection.
  if (chosenIndices.length) selectTimedCues(available, chosenIndices);
  const selection = new Set(chosenIndices);
  for (const index of [...new Set(candidateIndices)].sort((a, b) => a - b)) {
    if (selection.size >= ROLEPLAY_MAX_SCENARIOS) break;
    if (!Number.isSafeInteger(index) || index < 0 || index >= available.length) continue;
    if (selection.has(index) ||
        classifySpeakerRole(available[index].speaker) === 'interpreter') continue;
    const proposed = [...selection, index].sort((a, b) => a - b);
    try {
      selectTimedCues(available, proposed);
      selection.add(index);
    } catch {
      // Do not select overlaps, excessive durations, or invalid timestamps.
      // Keep the administrator's manually chosen clips unchanged.
    }
  }
  return [...selection].sort((a, b) => a - b);
}
