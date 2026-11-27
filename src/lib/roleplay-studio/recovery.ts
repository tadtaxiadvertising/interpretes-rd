import { createLongMediaDraft, openLongMediaDraft } from './long-media';
import { MAX_STUDIO_DRAFT_CHARS, type StudioDraftSegment } from './draft';

export const STUDIO_RECOVERY_KEY = 'interpretes-rd:audio-studio:recovery:v1';
// Up to 100 opaque receipt hashes plus states, without reducing the existing
// editorial draft budget. Legacy envelopes remain accepted.
const MAX_RECOVERY_CHARS = MAX_STUDIO_DRAFT_CHARS + 4096 + 100 * 100;
export type RecoveryProductionReceipt = { key: string; status: 'unconfirmed' | 'created' };
const MAX_RECEIPTS = 100;
export function validateProductionReceipts(value: unknown): RecoveryProductionReceipt[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_RECEIPTS) throw new Error('Progreso de producción incompatible.');
  const seen = new Set<string>();
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry.key) || seen.has(entry.key) ||
        (entry.status !== 'unconfirmed' && entry.status !== 'created'))
      throw new Error('Progreso de producción incompatible.');
    seen.add(entry.key);
    return { key: entry.key, status: entry.status };
  });
}
export function mergeProductionReceipts(previous: readonly RecoveryProductionReceipt[], incoming: readonly RecoveryProductionReceipt[]) {
  const result = new Map(previous.map(entry => [entry.key, entry.status]));
  for (const entry of incoming) {
    const status = result.get(entry.key) === 'created' ? 'created' : entry.status;
    result.delete(entry.key);
    result.set(entry.key, status);
  }
  return [...result].slice(-MAX_RECEIPTS).map(([key,status]) => ({key,status}));
}
/** Only used with an exact, already validated backup snapshot. */
export function updateRecoveryProduction(raw: string, receipt: RecoveryProductionReceipt): string {
  if (!raw || raw.length > MAX_RECOVERY_CHARS) throw new Error('Respaldo local no válido.');
  const saved = JSON.parse(raw);
  if (!saved || saved.version !== 1 || !saved.draft) throw new Error('Respaldo local incompatible.');
  saved.production = mergeProductionReceipts(validateProductionReceipts(saved.production), validateProductionReceipts([receipt]));
  const next = JSON.stringify(saved);
  if (next.length > MAX_RECOVERY_CHARS) throw new Error('La recuperación local supera el tamaño permitido.');
  return next;
}
type RecoveryTurn = StudioDraftSegment & { id: string };

export function createStudioRecovery(
  size: number, fingerprint: string, duration: number, turns: readonly RecoveryTurn[],
  confirmed: ReadonlySet<string>, activeId: string | undefined, playhead: number,
  excluded: readonly StudioDraftSegment[] = [],
  production: readonly RecoveryProductionReceipt[] = [],
): string {
  const draft = createLongMediaDraft(size, fingerprint, turns, duration);
  if (JSON.stringify(draft).length > MAX_STUDIO_DRAFT_CHARS) throw new Error('El borrador supera el tamaño permitido.');
  const raw = JSON.stringify({
    version: 1, draft,
    ...(excluded.length ? { excluded: createLongMediaDraft(size, fingerprint, excluded, duration) } : {}),
    ...(production.length ? { production: validateProductionReceipts(production) } : {}),
    confirmed: turns.flatMap((turn, index) => confirmed.has(turn.id) ? [index] : []),
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
  const excluded = saved.excluded === undefined ? [] : openLongMediaDraft(JSON.stringify(saved.excluded), size, fingerprint, duration);
  return { segments, excluded, production: validateProductionReceipts(saved.production), confirmed: new Set<number>(saved.confirmed), active: saved.active as number,
    playhead: Math.min(duration, saved.playhead as number) };
}
