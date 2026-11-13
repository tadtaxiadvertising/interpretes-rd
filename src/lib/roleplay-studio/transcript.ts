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
export function parseTimedTranscript(raw: string): TimedTranscriptCue[] {
  if (!raw.trim() || raw.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error('El archivo de subtítulos está vacío o supera el límite de 1 MB.');
  }
  const blocks = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const cues: TimedTranscriptCue[] = [];
  let sum = 0;
  let previousEnd = 0;

  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length || /^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/i.test(lines[0])) continue;
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = CUE_TIMING.exec(lines[timingIndex]);
    if (!timing) throw new Error('Los subtítulos contienen un intervalo de tiempo no válido.');
    const start = decodeTimestamp(timing[1]);
    const end = decodeTimestamp(timing[2]);
    if (start === null || end === null || end - start < 0.1 ||
        start < previousEnd || end - start > MAX_CLIP_DURATION || end > MAX_SOURCE_DURATION) {
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
    cues.push({ start, end, speaker, text });
    if (cues.length > ROLEPLAY_MAX_SCENARIOS) {
      throw new Error(`El archivo supera ${ROLEPLAY_MAX_SCENARIOS} intervenciones. Agrupa o selecciona los fragmentos antes de importar.`);
    }
    sum += end - start;
    if (sum > MAX_TOTAL_DURATION) throw new Error('Los fragmentos superan los 15 minutos acumulados permitidos.');
    previousEnd = end;
  }

  if (!cues.length) throw new Error('No se encontraron tiempos SRT o WebVTT válidos.');
  return cues;
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
