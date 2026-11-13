/**
 * Silence detection is an editorial aid, not speaker diarization: short
 * pauses cannot establish who spoke or which language was used.
 */
export interface StudioSilence {
  start: number;
  end: number;
}

export interface StudioSuggestedClip {
  start: number;
  end: number;
}

export interface StudioSilenceSuggestions {
  clips: StudioSuggestedClip[];
  omittedCount: number;
}

/** Parse only duration-bound numeric silencedetect events, never raw FFmpeg logs. */
export function parseStudioSilences(stderr: string, duration: number): StudioSilence[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 7200 ||
      stderr.length > 300_000) return [];
  const results: StudioSilence[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const start = /\bsilence_start:\s*(\d+(?:\.\d+)?)(?:\s|$)/.exec(line);
    if (start) {
      const value = Number(start[1]);
      pendingStart = Number.isFinite(value) && value >= 0 && value < duration ? value : null;
      continue;
    }
    const end = /\bsilence_end:\s*(\d+(?:\.\d+)?)(?:\s|\||$)/.exec(line);
    if (!end || pendingStart === null) continue;
    const value = Number(end[1]);
    if (Number.isFinite(value) && value > pendingStart && value <= duration + 0.1) {
      const normalized = Math.min(duration, value);
      if (results.length && pendingStart < results[results.length - 1].end) {
        pendingStart = null;
        continue;
      }
      results.push({ start: pendingStart, end: normalized });
      if (results.length > 500) throw new Error('Demasiadas pausas para esta revisión.');
    }
    pendingStart = null;
  }
  // FFmpeg may leave a final silence_start unmatched when the file ends.
  if (pendingStart !== null && pendingStart < duration &&
      (results.length === 0 || pendingStart >= results[results.length - 1].end)) {
    results.push({ start: pendingStart, end: duration });
  }
  return results;
}

/**
 * Propose speech windows bounded by detected silence. Never auto-publish.
 * Very long windows, small noise and clips exceeding platform limits are
 * excluded rather than silently cut mid-sentence.
 */
export function suggestStudioClips(
  silences: readonly StudioSilence[], duration: number,
): StudioSilenceSuggestions {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 7200) {
    return { clips: [], omittedCount: 0 };
  }
  const clips: StudioSuggestedClip[] = [];
  let omittedCount = 0;
  let cursor = 0;
  let accumulated = 0;

  const includeWindow = (start: number, end: number) => {
    const seconds = end - start;
    if (seconds < 1.25) return;
    if (seconds > 300 || clips.length >= 25 || accumulated + seconds > 900) {
      omittedCount++;
      return;
    }
    clips.push({
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
    });
    accumulated += seconds;
  };

  for (const silence of silences) {
    if (!Number.isFinite(silence.start) || !Number.isFinite(silence.end) ||
        silence.start < cursor || silence.end <= silence.start ||
        silence.end > duration + 0.1) {
      return { clips: [], omittedCount: 0 };
    }
    includeWindow(cursor, silence.start);
    cursor = Math.min(duration, silence.end);
  }
  includeWindow(cursor, duration);
  return { clips, omittedCount };
}
