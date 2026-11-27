import { ROLEPLAY_STUDIO_PACKAGE_MAX_SCENARIOS, ROLEPLAY_STUDIO_PACKAGE_MAX_AUDIO_SECONDS } from '@/lib/roleplay-limits';
import { studioSelectedSeconds, validStudioRanges } from './compound-cuts';

export const STUDIO_PACKAGE_AUDIO_SECONDS = ROLEPLAY_STUDIO_PACKAGE_MAX_AUDIO_SECONDS;

type PartTurn = { id: string; start: number; end: number; ranges?: unknown };
export type StudioPublicationPart<T> = {
  key: string;
  number: number;
  first: number;
  last: number;
  seconds: number;
  turns: T[];
};

/** Chronological, non-destructive partitions. Never discard an invalid turn. */
export function planStudioPublicationParts<T extends PartTurn>(
  segments: readonly T[], duration: number,
): { parts: StudioPublicationPart<T>[]; issue: string | null } {
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  const parts: StudioPublicationPart<T>[] = [];
  let turns: T[] = [];
  let seconds = 0;
  let first = 1;
  let end = 0;
  const flush = () => {
    if (!turns.length) return;
    parts.push({ key: JSON.stringify(turns.map(turn => turn.id)), number: parts.length + 1,
      first, last: first + turns.length - 1, seconds, turns });
    first += turns.length;
    turns = [];
    seconds = 0;
  };
  for (const [index, turn] of ordered.entries()) {
    const ranges = validStudioRanges(turn, duration);
    if (!ranges || turn.start < end) {
      return { parts: [], issue: `Corrige los tiempos o solapamientos de la intervención ${index + 1} antes de preparar las partes.` };
    }
    const length = studioSelectedSeconds(ranges);
    if (turns.length >= ROLEPLAY_STUDIO_PACKAGE_MAX_SCENARIOS || seconds + length > STUDIO_PACKAGE_AUDIO_SECONDS) flush();
    turns.push(turn);
    seconds += length;
    end = turn.end;
  }
  flush();
  return { parts, issue: null };
}
