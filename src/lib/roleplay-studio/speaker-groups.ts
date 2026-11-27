import { titleAfterProfileChange, type StudioLanguage, type StudioSpeakerRole } from './speaker-profiles';

/** Only explicit, numbered diarization labels; never infer identities from names or roles. */
export function sourceSpeakerGroup(label: string | null): string | undefined {
  const match = /^(speaker|hablante|locutor)[ _-]?(\d{1,4})$/i.exec(label?.trim() ?? '');
  return match ? `${match[1].toLowerCase()} ${match[2]}` : undefined;
}

type GroupTurn = { id: string; start: number; title: string; speakerRole: StudioSpeakerRole;
  language: StudioLanguage; sourceSpeakerGroup?: string };

export function propagateSpeakerProfile<T extends GroupTurn>(turns: readonly T[], activeId: string): {
  turns: T[]; changed: number;
} {
  const active = turns.find(turn => turn.id === activeId);
  if (!active?.sourceSpeakerGroup || active.speakerRole === 'unknown' || active.speakerRole === 'interpreter') {
    return { turns: [...turns], changed: 0 };
  }
  const order = new Map([...turns].sort((a, b) => a.start - b.start).map((turn, i) => [turn.id, i]));
  let changed = 0;
  const result = turns.map(turn => {
    if (turn.id === activeId || turn.sourceSpeakerGroup !== active.sourceSpeakerGroup ||
        (turn.speakerRole !== 'unknown' && turn.speakerRole !== active.speakerRole)) return turn;
    const speakerRole = active.speakerRole;
    const language = turn.language === 'unknown' ? active.language : turn.language;
    if (speakerRole === turn.speakerRole && language === turn.language) return turn;
    changed++;
    return { ...turn, speakerRole, language, title: titleAfterProfileChange(
      turn.title, turn.speakerRole, turn.language, order.get(turn.id) ?? 0, speakerRole, language,
    ) };
  });
  return { turns: result, changed };
}
