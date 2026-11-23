import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { safePublishableSpeakerLabel } from './speaker-profiles';

export interface TimedTranscriptCue {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
}

const MAX_TRANSCRIPT_CHARS = 1_000_000;
const MAX_TOTAL_DURATION = 900;
const MAX_SOURCE_DURATION = 7200;
const MAX_CLIP_DURATION = 300;
const MAX_LOCAL_SOURCE_DURATION = 12 * 3600;
const MAX_LOCAL_TRANSCRIPT_CHARS = 5_000_000;
const MAX_LOCAL_CUES = 10_000;

function decodeTimestamp(value: string): number | null {
  const parts = value.replace(',', '.').split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const hasHours = parts.length === 3;
  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = hasHours ? Number(parts.at(-3)) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite) || seconds >= 60 ||
      minutes >= 60 || hours < 0 || minutes < 0 || seconds < 0) return null;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000) / 1000;
}

const CUE_TIMING = /^((?:\d{2}:)?\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[.,]\d{1,3})(?:\s+.*)?$/;

/**
 * Strict, offline SRT/WebVTT cue import.
 * Transcript text stays in the admin browser; only timestamps and a speaker
 * label may become scenario titles. The transcript is NOT copied into
 * scriptPrompt, so participants never see the source dialogue as a hint.
 */
interface TranscriptParseLimits {
  maxCues?: number;
  maxTotalSeconds?: number;
  maxSourceSeconds?: number;
  maxChars?: number;
  allowOverlaps?: boolean;
  sortOutOfOrder?: boolean;
  splitLongCues?: boolean;
  useSourceTimelineBudget?: boolean;
  onOriginalCue?: (start: number, end: number) => void;
}

export function parseTimedTranscript(
  raw: string, limits: TranscriptParseLimits = {},
): TimedTranscriptCue[] {
  const maxCues = limits.maxCues ?? ROLEPLAY_MAX_SCENARIOS;
  const maxTotalSeconds = limits.maxTotalSeconds ?? MAX_TOTAL_DURATION;
  const maxSourceSeconds = limits.maxSourceSeconds ?? MAX_SOURCE_DURATION;
  const maxChars = limits.maxChars ?? MAX_TRANSCRIPT_CHARS;
  if (!Number.isSafeInteger(maxCues) || maxCues < 1 || maxCues > MAX_LOCAL_CUES ||
      !Number.isFinite(maxTotalSeconds) || maxTotalSeconds < 1 ||
      !Number.isFinite(maxSourceSeconds) || maxSourceSeconds < 1 ||
      maxSourceSeconds > MAX_LOCAL_SOURCE_DURATION || maxTotalSeconds > maxSourceSeconds ||
      !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > MAX_LOCAL_TRANSCRIPT_CHARS) {
    throw new Error('Los límites de transcripción no son válidos.');
  }
  if (!raw.trim() || raw.length > maxChars) {
    throw new Error('El archivo de subtítulos está vacío o supera el límite de tamaño permitido.');
  }
  const blocks = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const cues: TimedTranscriptCue[] = [];
  let sum = 0;
  let previousEnd = 0;
  let previousStart = 0;

  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length || /^(?:NOTE|STYLE|REGION)(?:\s|$)/i.test(lines[0])) continue;
    // Valid WebVTT files may place the first timing cue immediately after
    // the WEBVTT header without an empty separator. Discard only the header,
    // never the entire block containing that first intervention.
    if (/^WEBVTT(?:\s|$)/i.test(lines[0])) lines.shift();
    if (!lines.length) continue;
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = CUE_TIMING.exec(lines[timingIndex]);
    if (!timing) throw new Error('Los subtítulos contienen un intervalo de tiempo no válido.');
    const start = decodeTimestamp(timing[1]);
    const end = decodeTimestamp(timing[2]);
    if (start === null || end === null || end - start < 0.1 ||
        (!limits.sortOutOfOrder && start < previousStart) ||
        (!limits.allowOverlaps && start < previousEnd) ||
        (!limits.splitLongCues && end - start > MAX_CLIP_DURATION) || end > maxSourceSeconds) {
      throw new Error('Los subtítulos contienen tiempos superpuestos, fuera de orden o demasiado largos.');
    }
    const originalText = lines.slice(timingIndex + 1).join(' ').trim();
    if (!originalText) throw new Error('Hay una intervención sin texto.');
    const voice = /^<v\s+([^>]{1,60})>/i.exec(originalText);
    const bracket = /^\[([^\]]{1,60})\]/.exec(originalText);
    const prefix = /^([^:]{2,50}):\s+/.exec(originalText);
    const speaker = (voice?.[1] ?? bracket?.[1] ?? prefix?.[1] ?? '').trim().slice(0, 60) || null;
    const text = originalText.replace(/<[^>]*>/g, '').trim();
    if (!text) throw new Error('Hay una intervención sin texto legible.');
    limits.onOriginalCue?.(start, end);
    // Long SRT cues are reference windows, not automatically published clips.
    // Divide their timing into bounded windows without guessing word alignments.
    // Repeating the original reference text is preferable to inventing dialogue.
    const parts = limits.splitLongCues ? Math.ceil((end - start) / MAX_CLIP_DURATION) : 1;
    if (cues.length + parts > maxCues) {
      throw new Error(`El archivo supera ${maxCues} intervenciones. Divide la transcripción en archivos más pequeños.`);
    }
    for (let part = 0; part < parts; part++) {
      // Even partitions avoid a trailing fragment shorter than 100 ms.
      const partStart = part === 0 ? start : Math.round((start + (end - start) * part / parts) * 1000) / 1000;
      const partEnd = part === parts - 1 ? end : Math.round((start + (end - start) * (part + 1) / parts) * 1000) / 1000;
      cues.push({ start: partStart, end: partEnd, speaker, text });
    }
    if (cues.length > maxCues) {
      throw new Error(`El archivo supera ${maxCues} intervenciones. Divide la transcripción en archivos más pequeños.`);
    }
    sum += end - start;
    if (!limits.useSourceTimelineBudget && sum > maxTotalSeconds) {
      throw new Error('La duración acumulada de los subtítulos supera el límite permitido.');
    }
    previousStart = start;
    previousEnd = Math.max(previousEnd, end);
  }

  if (!cues.length) throw new Error('No se encontraron tiempos SRT o WebVTT válidos.');
  // The review timeline must be chronological even if the provider exported
  // SRT blocks in speaker order. Stable sorting preserves ties for inspection.
  if (limits.sortOutOfOrder) cues.sort((a, b) => a.start - b.start || a.end - b.end);
  if (limits.useSourceTimelineBudget) {
    // Caption streams can overlap (e.g. simultaneous bilingual speakers).
    // For review, count seconds of source media covered, not repeated speech
    // streams. The final selected roleplay still has its own 900 s cap.
    let covered = 0;
    let latestEnd = 0;
    for (const cue of cues) {
      covered += Math.max(0, cue.end - Math.max(cue.start, latestEnd));
      latestEnd = Math.max(latestEnd, cue.end);
      if (covered > maxTotalSeconds + 0.0005) {
        throw new Error('La duración acumulada de los subtítulos supera el límite permitido.');
      }
    }
  }
  return cues;
}

/** Diagnostics are private editor hints; no original dialogue enters publishable metadata. */
export interface TranscriptReviewDiagnostics {
  reordered: number;
  overlapping: number;
  divided: number;
}

/**
 * Keep imperfect provider timestamps visible to the editor, but surface
 * automatic repairs for explicit human review before any cuts are applied.
 */
export function parseTimedTranscriptForReviewWithDiagnostics(
  raw: string, longLocalSource = false,
): { cues: TimedTranscriptCue[]; diagnostics: TranscriptReviewDiagnostics } {
  const diagnostics: TranscriptReviewDiagnostics = { reordered: 0, overlapping: 0, divided: 0 };
  let lastOriginalStart = -1;
  const cues = parseTimedTranscript(raw, {
    // Long MP3 recordings can have thousands of short SRT cues. Both modes
    // are bounded to 10k reference cues; the standard MP3 mode remains
    // capped to 1 MB / 2 hours and only 25 selected cues may be exported.
    maxCues: MAX_LOCAL_CUES,
    maxTotalSeconds: longLocalSource ? MAX_LOCAL_SOURCE_DURATION : MAX_SOURCE_DURATION,
    maxSourceSeconds: longLocalSource ? MAX_LOCAL_SOURCE_DURATION : MAX_SOURCE_DURATION,
    maxChars: longLocalSource ? MAX_LOCAL_TRANSCRIPT_CHARS : MAX_TRANSCRIPT_CHARS,
    allowOverlaps: true,
    sortOutOfOrder: true,
    splitLongCues: true,
    useSourceTimelineBudget: true,
    onOriginalCue: (start, end) => {
      if (start < lastOriginalStart) diagnostics.reordered += 1;
      if (end - start > MAX_CLIP_DURATION) diagnostics.divided += 1;
      lastOriginalStart = start;
    },
  });

  // Count actual overlaps chronologically, not false overlaps introduced
  // solely by the provider's original unsorted block order.
  let latestEnd = 0;
  for (const cue of cues) {
    if (cue.start < latestEnd - 0.0005) diagnostics.overlapping += 1;
    latestEnd = Math.max(latestEnd, cue.end);
  }
  return { cues, diagnostics };
}

/** Parse a source transcript for manual selection, never publish all cues automatically. */
export function parseTimedTranscriptForReview(raw: string, longLocalSource = false): TimedTranscriptCue[] {
  return parseTimedTranscriptForReviewWithDiagnostics(raw, longLocalSource).cues;
}

/** Build publishable metadata without copying personal names or transcript text. */
export function toPublishableStudioSegments(cues: TimedTranscriptCue[]) {
  return cues.map((cue, index) => {
    const role = safePublishableSpeakerLabel(cue.speaker);
    return {
      title: role ? `${role} · ${index + 1}` : `Intervención ${index + 1}`,
      start: cue.start,
      end: cue.end,
      scriptPrompt: '',
      responseLimit: 120,
    };
  });
}
