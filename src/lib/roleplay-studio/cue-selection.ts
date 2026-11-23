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
  // SRT exports sometimes contain a long background caption spanning many
  // separate utterances. Prefer the next cue that finishes first rather than
  // locking a five-minute region before inspecting its shorter alternatives.
  // This interval-scheduling heuristic makes room for more playable turns.
  // Keep existing manual choices fixed and return the final result in
  // transcript order; the 25-turn / 900-second export checks remain unchanged.
  const candidates = [...new Set(candidateIndices)]
    .filter(index => Number.isSafeInteger(index) && index >= 0 && index < available.length)
    .sort((left, right) => available[left].end - available[right].end ||
      available[left].start - available[right].start || left - right);
  for (const index of candidates) {
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


/**
 * Suggest representative source turns across an entire long recording instead
 * of spending all 25 slots on the earliest captions. This is a deterministic
 * editorial starting point, not automatic speaker identification.
 *
 * Time-bucket candidates favor readable, role-labeled turns and avoid very
 * long background captions where a shorter utterance is available. The
 * canonical selection validator remains the final authority on overlaps,
 * 25-turn limits and the 15-minute package budget.
 */
export function suggestRepresentativeTimedCueSelection(
  available: readonly TimedTranscriptCue[],
  candidateIndices: readonly number[],
): number[] {
  const indices = [...new Set(candidateIndices)]
    .filter(index => Number.isSafeInteger(index) && index >= 0 && index < available.length)
    .filter(index => classifySpeakerRole(available[index].speaker) !== 'interpreter')
    .filter(index => {
      const cue = available[index];
      return Number.isFinite(cue.start) && Number.isFinite(cue.end) &&
        cue.start >= 0 && cue.end > cue.start && cue.end - cue.start <= 300;
    });
  if (indices.length <= ROLEPLAY_MAX_SCENARIOS) {
    return fillCompatibleTimedCueSelection(available, [], indices);
  }

  const sorted = indices.sort((a, b) =>
    available[a].start - available[b].start || available[a].end - available[b].end || a - b);
  const first = available[sorted[0]].start;
  const last = sorted.reduce((end, index) => Math.max(end, available[index].end), first);
  const numberOfBuckets = ROLEPLAY_MAX_SCENARIOS;
  const windowSeconds = Math.max((last - first) / numberOfBuckets, 0.001);
  const buckets: number[][] = Array.from({ length: numberOfBuckets }, () => []);

  for (const index of sorted) {
    const bucket = Math.min(numberOfBuckets - 1,
      Math.max(0, Math.floor((available[index].start - first) / windowSeconds)));
    buckets[bucket].push(index);
  }

  const chosen: number[] = [];
  for (let bucket = 0; bucket < numberOfBuckets; bucket++) {
    if (chosen.length >= ROLEPLAY_MAX_SCENARIOS) break;
    const targetTime = first + (bucket + 0.5) * windowSeconds;
    const score = (index: number) => {
      const cue = available[index];
      const seconds = cue.end - cue.start;
      // A caption lasting minutes is a poor representative when a normal
      // sentence-length subtitle is available at the same source position.
      const longCaptionPenalty = seconds > 60 ? 4 : 0;
      const unknownRolePenalty = classifySpeakerRole(cue.speaker) === 'unknown' ? 1 : 0;
      return longCaptionPenalty + unknownRolePenalty +
        Math.abs(cue.start - targetTime) / windowSeconds;
    };
    const ranked = buckets[bucket].sort((a, b) => score(a) - score(b) ||
      available[a].end - available[b].end || a - b);
    for (const index of ranked) {
      try {
        selectTimedCues(available, [...chosen, index]);
        chosen.push(index);
        break;
      } catch {
        // Move on to another valid, compatible candidate in this window.
      }
    }
  }
  // For sparse timelines, fill remaining slots only with compatible turns.
  // This is a suggestion for manual review, never an automatic export.
  return fillCompatibleTimedCueSelection(available, chosen, sorted);
}
