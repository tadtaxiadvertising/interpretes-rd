import { ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { validStudioRanges } from './compound-cuts';
import type { StudioSpeakerRole, StudioLanguage } from './speaker-profiles';

type ReviewTurn = { id: string; start: number; end: number; ranges?: unknown;
  title: string; scriptPrompt: string; responseLimit: number; speakerRole: StudioSpeakerRole; language: StudioLanguage };

/** Editorial review only. Publication still performs its independent checks. */
export function studioReviewIssue(turn: ReviewTurn, all: readonly ReviewTurn[], duration: number): string | null {
  if (turn.speakerRole === 'interpreter') return 'Excluye la voz del intérprete original.';
  if (turn.speakerRole === 'unknown') return 'Identifica el hablante.';
  if (turn.language === 'unknown') return 'Selecciona el idioma.';
  if (!turn.title.trim() || turn.title.length > 200) return 'Revisa el título (1–200 caracteres).';
  if (!validStudioRanges(turn, duration)) return 'Corrige los límites de audio.';
  if (all.some(other => other.id !== turn.id && turn.start < other.end && other.start < turn.end)) {
    return 'Corrige el solapamiento con otra intervención.';
  }
  if (turn.scriptPrompt.length > 5000) return 'Reduce las instrucciones a 5000 caracteres.';
  if (!Number.isInteger(turn.responseLimit) || turn.responseLimit < 0 ||
      turn.responseLimit > ROLEPLAY_RESPONSE_MAX_DURATION_SEC) return 'Revisa el tiempo de respuesta.';
  return null;
}

/** Advance chronologically, wrapping once to earlier unconfirmed visible turns. */
export function nextUnconfirmedTurn<T extends { id: string }>(
  visible: readonly T[], activeId: string, confirmed: ReadonlySet<string>,
): T | undefined {
  const index = visible.findIndex(turn => turn.id === activeId);
  return [...visible.slice(index + 1), ...visible.slice(0, Math.max(0, index))]
    .find(turn => turn.id !== activeId && !confirmed.has(turn.id));
}
