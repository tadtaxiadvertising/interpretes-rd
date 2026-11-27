import { validStudioRanges } from './compound-cuts';
import type { StudioSilence } from './silence-analysis';

type Cut = { id: string; start: number; end: number; ranges?: unknown };
export type BoundaryProposal = { start: number; end: number; reason: 'overlap' | 'silence' };

const MAX_OVERLAP_TRIM = 0.5;
const MAX_SILENCE_TRIM = 1.5;
const SILENCE_MARGIN = 0.2;
const MIN_REMAINING = 0.5;

/** Conservative proposals only: never expand a cut or infer speech from timing. */
export function proposeStudioBoundaries(
  cut: Cut, active: readonly Cut[], duration: number, silences: readonly StudioSilence[] = [],
): BoundaryProposal | null {
  if (cut.ranges !== undefined || !validStudioRanges(cut, duration) || cut.end > duration) return null;
  const others = active.filter(other => other.id !== cut.id);
  if (others.some(other => !Number.isFinite(other.start) || !Number.isFinite(other.end) || other.end <= other.start)) return null;
  const overlaps = others.filter(other => cut.start < other.end && other.start < cut.end);
  let start = cut.start;
  let end = cut.end;
  let reason: BoundaryProposal['reason'] = 'silence';
  if (overlaps.length) {
    reason = 'overlap';
    for (const other of overlaps) {
      if (other.start < cut.start && other.end < cut.end) {
        start = Math.max(start, other.end);
      } else if (other.start > cut.start && other.end > cut.end) {
        end = Math.min(end, other.start);
      } else return null; // containment or ambiguous equal boundary
    }
    if (start - cut.start > MAX_OVERLAP_TRIM + 1e-6 || cut.end - end > MAX_OVERLAP_TRIM + 1e-6) return null;
  } else {
    for (const pause of silences) {
      if (!Number.isFinite(pause.start) || !Number.isFinite(pause.end) || pause.start < 0 ||
          pause.end > duration || pause.end - pause.start < 0.4) continue;
      if (pause.start <= cut.start && pause.end < cut.end) {
        start = Math.max(start, Math.min(cut.start + MAX_SILENCE_TRIM, pause.end - SILENCE_MARGIN));
      }
      if (pause.start > cut.start && pause.end >= cut.end) {
        end = Math.min(end, Math.max(cut.end - MAX_SILENCE_TRIM, pause.start + SILENCE_MARGIN));
      }
    }
  }
  if (start - cut.start < 0.05 && cut.end - end < 0.05) return null;
  if (end - start < MIN_REMAINING || !validStudioRanges({ start, end }, duration) ||
      others.some(other => start < other.end && other.start < end)) return null;
  return { start, end, reason };
}
