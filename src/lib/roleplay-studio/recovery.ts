import { createLongMediaDraft, openLongMediaDraft } from './long-media';
import { MAX_STUDIO_DRAFT_CHARS, type StudioDraftSegment } from './draft';

export const STUDIO_RECOVERY_KEY = 'interpretes-rd:audio-studio:recovery:v1';
const MAX_RECOVERY_CHARS = MAX_STUDIO_DRAFT_CHARS + 4096;
type RecoveryTurn = StudioDraftSegment & { id: string };

export function createStudioRecovery(
  size: number, fingerprint: string, duration: number, turns: readonly RecoveryTurn[],
  confirmed: ReadonlySet<string>, activeId: string | undefined, playhead: number,
): string {
  const draft = createLongMediaDraft(size, fingerprint, turns, duration);
  if (JSON.stringify(draft).length > MAX_STUDIO_DRAFT_CHARS) throw new Error('El borrador supera el tamaño permitido.');
  const raw = JSON.stringify({
    version: 1, draft, confirmed: turns.flatMap((turn, index) => confirmed.has(turn.id) ? [index] : []),
    active: turns.findIndex(turn => turn.id === activeId),
    playhead: Number.isFinite(playhead) ? Math.max(0, Math.min(duration, playhead)) : 0,
  });
  if (raw.length > MAX_RECOVERY_CHARS) throw new Error('La recuperación local supera el tamaño permitido.');
  return raw;
}

export function openStudioRecovery(raw: string, size: number, fingerprint: string, duration: number) {
  if (!raw || raw.length > MAX_RECOVERY_CHARS) throw new Error('Respaldo local no válido.');
  const saved = JSON.parse(raw);
  if (!saved || saved.version !== 1 || !saved.draft || !Array.isArray(saved.confirmed)) {
    throw new Error('Respaldo local incompatible.');
  }
  const segments = openLongMediaDraft(JSON.stringify(saved.draft), size, fingerprint, duration);
  if (!saved.confirmed.every((index: unknown) => typeof index === 'number' &&
    Number.isInteger(index) && index >= 0 && index < segments.length) ||
    !Number.isInteger(saved.active) || saved.active < -1 || saved.active >= segments.length ||
    typeof saved.playhead !== 'number' || !Number.isFinite(saved.playhead) ||
    saved.playhead < 0 || saved.playhead > duration + 0.5) {
    throw new Error('Progreso editorial incompatible.');
  }
  return { segments, confirmed: new Set<number>(saved.confirmed), active: saved.active as number,
    playhead: Math.min(duration, saved.playhead as number) };
}
