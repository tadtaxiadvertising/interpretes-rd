import type { LocalVadSegment } from './local-vad';
import type { StudioSuggestedClip } from './silence-analysis';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';

type TimeRange = { start: number; end: number };
export type LocalVadSuggestions = {
  clips: StudioSuggestedClip[];
  omittedCount: number;
};

/**
 * VAD detects speech-like energy, not actual speakers. Merge its padded
 * windows, then omit (never clip mid-sentence) those that would overlap an
 * editorial cut or exceed the existing 25-cut / 15-minute export contract.
 * Neither waveform audio nor transcript text is used or retained here.
 */
export function proposeLocalVadCuts(
  speech: readonly LocalVadSegment[],
  duration: number,
  current: readonly TimeRange[],
): LocalVadSuggestions {
  const rejected = { clips: [] as StudioSuggestedClip[], omittedCount: 0 };
  if (!Number.isFinite(duration) || duration <= 0 || duration > 240 ||
      current.length > ROLEPLAY_MAX_SCENARIOS ||
      current.some(cut => !Number.isFinite(cut.start) || !Number.isFinite(cut.end) ||
        cut.start < 0 || cut.end <= cut.start || cut.end > duration + 0.1)) return rejected;
  if (speech.length > 100 || speech.some(cut =>
    !Number.isFinite(cut.start) || !Number.isFinite(cut.end) ||
    cut.start < 0 || cut.end <= cut.start || cut.end > duration + 0.01)) return rejected;

  const ordered = [...speech].sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const cut of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && cut.start <= previous.end) {
      previous.end = Math.max(previous.end, cut.end);
    } else {
      merged.push({ start: cut.start, end: cut.end });
    }
  }

  let selectedTotal = current.reduce((sum, cut) => sum + cut.end - cut.start, 0);
  const clips: StudioSuggestedClip[] = [];
  let omittedCount = 0;
  for (const cut of merged) {
    // Round inward to hundredths; never extend a window into another clip.
    const start = Math.max(0, Math.ceil((cut.start - 1e-8) * 100) / 100);
    const end = Math.floor((cut.end + 1e-8) * 100) / 100;
    const seconds = end - start;
    if (seconds < 1.25 || seconds > 300 || clips.length + current.length >= ROLEPLAY_MAX_SCENARIOS ||
        selectedTotal + seconds > 900 + 1e-8 ||
        current.some(existing => start < existing.end && end > existing.start)) {
      omittedCount += 1;
      continue;
    }
    clips.push({ start, end });
    selectedTotal += seconds;
  }
  return { clips, omittedCount };
}
