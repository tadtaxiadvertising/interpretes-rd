import { ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { validStudioRanges } from './compound-cuts';
import { hasStudioProfileLanguageMismatch, studioEditorialProfile, type StudioSpeakerRole, type StudioLanguage } from './speaker-profiles';

type ReviewTurn = { id: string; start: number; end: number; ranges?: unknown;
  title: string; scriptPrompt: string; responseLimit: number; speakerRole: StudioSpeakerRole; language: StudioLanguage };

export type StudioReviewCode = 'interpreter' | 'speaker' | 'language' | 'title' | 'range' | 'overlap' | 'instructions' | 'response';
export type StudioReviewFinding = { code: StudioReviewCode; message: string };

/** Shared metadata limits; editorial and export callers retain their own policy and messages. */
export function studioTurnFieldValidity(turn: Pick<ReviewTurn, 'title' | 'scriptPrompt' | 'responseLimit'>) {
  return {
    title: Boolean(turn.title.trim()) && turn.title.length <= 200,
    instructions: turn.scriptPrompt.length <= 5000,
    response: Number.isInteger(turn.responseLimit) && turn.responseLimit >= 0 &&
      turn.responseLimit <= ROLEPLAY_RESPONSE_MAX_DURATION_SEC,
  };
}

/** All editorial issues, rather than hiding later problems behind the first one. */
export function studioReviewFindings(turn: ReviewTurn, all: readonly ReviewTurn[], duration: number): StudioReviewFinding[] {
  const issues: StudioReviewFinding[] = [];
  const fields = studioTurnFieldValidity(turn);
  if (turn.speakerRole === 'interpreter') issues.push({ code: 'interpreter', message: 'Excluye la voz del intérprete original.' });
  if (turn.speakerRole === 'unknown') issues.push({ code: 'speaker', message: 'Identifica el hablante.' });
  if (turn.language === 'unknown') issues.push({ code: 'language', message: 'Selecciona el idioma.' });
  else if (turn.speakerRole !== 'interpreter' && hasStudioProfileLanguageMismatch(turn.speakerRole, turn.language)) {
    const profile = studioEditorialProfile(turn.speakerRole)!;
    issues.push({ code: 'language', message: `El idioma no coincide con ${profile.label} (${profile.language.toUpperCase()}). Escucha y revisa el perfil.` });
  }
  if (!fields.title) issues.push({ code: 'title', message: 'Revisa el título (1–200 caracteres).' });
  if (!validStudioRanges(turn, duration)) issues.push({ code: 'range', message: 'Corrige los límites de audio.' });
  if (all.some(other => other.id !== turn.id && turn.start < other.end && other.start < turn.end)) {
    issues.push({ code: 'overlap', message: 'Corrige el solapamiento con otra intervención.' });
  }
  if (!fields.instructions) issues.push({ code: 'instructions', message: 'Reduce las instrucciones a 5000 caracteres.' });
  if (!fields.response) issues.push({ code: 'response', message: 'Revisa el tiempo de respuesta.' });
  return issues;
}

/** Editorial review only. Publication still performs its independent checks. */
export function studioReviewIssue(turn: ReviewTurn, all: readonly ReviewTurn[], duration: number): string | null {
  return studioReviewFindings(turn, all, duration)[0]?.message ?? null;
}

export function inspectStudioReview<T extends ReviewTurn>(turns: readonly T[], duration: number) {
  return [...turns].sort((a, b) => a.start - b.start).map((turn, index) => ({
    turn, number: index + 1, findings: studioReviewFindings(turn, turns, duration),
  }));
}

/** Advance chronologically, wrapping once to earlier unconfirmed visible turns. */
export function nextUnconfirmedTurn<T extends { id: string }>(
  visible: readonly T[], activeId: string, confirmed: ReadonlySet<string>,
): T | undefined {
  const index = visible.findIndex(turn => turn.id === activeId);
  return [...visible.slice(index + 1), ...visible.slice(0, Math.max(0, index))]
    .find(turn => turn.id !== activeId && !confirmed.has(turn.id));
}
