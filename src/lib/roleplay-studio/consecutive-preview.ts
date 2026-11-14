import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';

export type PreviewSourceTurn = {
  id: string;
  title: string;
  start: number;
  end: number;
  speakerRole: string;
};

export type PreviewTurn = Pick<PreviewSourceTurn, 'id' | 'title' | 'start' | 'end'> & {
  duration: number;
};

export type ConsecutivePreviewPlan = {
  turns: PreviewTurn[];
  excludedInterpreterCount: number;
  totalAudioSeconds: number;
};

const MAX_SOURCE_SECONDS = 7200;
const MAX_TURN_SECONDS = 300;
const MAX_TOTAL_AUDIO_SECONDS = 900;

/**
 * This is a read-only ADMIN editorial preview of segments marked for export.
 * Exclude the original interpreter and never access participant recordings.
 * Reject invalid cuts instead of silently previewing audio that cannot export.
 */
export function buildConsecutivePreviewPlan(
  segments: readonly PreviewSourceTurn[],
  sourceDuration: number,
): ConsecutivePreviewPlan {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 ||
      sourceDuration > MAX_SOURCE_SECONDS ||
      segments.length < 1 || segments.length > ROLEPLAY_MAX_SCENARIOS) {
    throw new Error('Selecciona un MP3 válido y entre 1 y 25 intervenciones.');
  }

  const excludedInterpreterCount = segments.filter(s => s.speakerRole === 'interpreter').length;
  const ordered = segments
    .filter(s => s.speakerRole !== 'interpreter')
    .slice()
    .sort((a, b) => a.start - b.start);

  if (!ordered.length) {
    throw new Error('Todos los cortes son del intérprete original. Añade intervenciones de otros hablantes.');
  }

  let lastEnd = 0;
  let totalAudioSeconds = 0;
  const turns: PreviewTurn[] = [];
  const ids = new Set<string>();

  for (const segment of ordered) {
    const duration = segment.end - segment.start;
    if (!segment.id || ids.has(segment.id) ||
        typeof segment.title !== 'string' || !segment.title.trim() ||
        !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
        segment.start < 0 || segment.start < lastEnd ||
        duration < 0.1 || duration > MAX_TURN_SECONDS ||
        segment.end > sourceDuration + 0.1) {
      throw new Error('Revisa los cortes: hay tiempos inválidos, solapados o intervenciones sin título.');
    }

    ids.add(segment.id);
    totalAudioSeconds += duration;
    lastEnd = segment.end;
    turns.push({
      id: segment.id,
      title: segment.title.trim(),
      start: segment.start,
      end: segment.end,
      duration,
    });
  }
  if (totalAudioSeconds > MAX_TOTAL_AUDIO_SECONDS) {
    throw new Error('La selección supera los 15 minutos máximos de audio del paquete.');
  }

  return { turns, excludedInterpreterCount, totalAudioSeconds };
}

/**
 * Matches the source simulator's formula: turn duration times the pause
 * multiplier plus fixed seconds. No speech recognition is attempted.
 */
export function consecutivePracticePause(
  audioSeconds: number,
  multiplier: number,
  fixedSeconds: number,
): number {
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0 ||
      !Number.isFinite(multiplier) || multiplier < 0.5 || multiplier > 3 ||
      !Number.isFinite(fixedSeconds) || fixedSeconds < 0 || fixedSeconds > 30) {
    throw new Error('Configuración de pausas fuera del rango permitido.');
  }
  return audioSeconds * multiplier + fixedSeconds;
}
