import { STUDIO_MAX_EDITOR_SEGMENTS } from './draft';
import { validStudioRanges } from './compound-cuts';

export const STUDIO_MAX_EXCLUDED_TURNS = STUDIO_MAX_EDITOR_SEGMENTS;
type Cut = { id: string; start: number; end: number; ranges?: unknown };

export function restoreExcludedIssue(turn: Cut, active: readonly Cut[], duration: number, limit: number): string | null {
  if (active.some(item => item.id === turn.id)) return 'La intervención ya está en el editor.';
  if (active.length >= limit) return 'Amplía el editor o libera espacio antes de recuperar.';
  if (!validStudioRanges(turn, duration)) return 'El corte excluido tiene límites inválidos; no se puede recuperar directamente.';
  if (active.some(item => turn.start < item.end && item.start < turn.end)) return 'El corte se solapa con una intervención actual. Ajusta primero los cortes existentes.';
  return null;
}
