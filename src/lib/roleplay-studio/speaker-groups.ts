import { studioEditorialProfile, titleAfterProfileChange, type StudioLanguage, type StudioSpeakerRole } from './speaker-profiles';

/** Only explicit, numbered diarization labels; never infer identities from names or roles. */
export function sourceSpeakerGroup(label: string | null): string | undefined {
  const match = /^(speaker|hablante|locutor)[ _-]?(\d{1,4})$/i.exec(label?.trim() ?? '');
  return match ? `${match[1].toLowerCase()} ${match[2]}` : undefined;
}

type GroupTurn = { id: string; start: number; title: string; speakerRole: StudioSpeakerRole;
  language: StudioLanguage; sourceSpeakerGroup?: string };

export function propagateSpeakerProfile<T extends GroupTurn>(turns: readonly T[], activeId: string, options: { visibleIds?: ReadonlySet<string>; protectedIds?: ReadonlySet<string> } = {}): {
  turns: T[]; changed: number;
} {
  const active = turns.find(turn => turn.id === activeId);
  const profile = active && studioEditorialProfile(active.speakerRole);
  if (!active?.sourceSpeakerGroup || !profile || profile.role === 'interpreter' || active.language !== profile.language ||
      (options.visibleIds && !options.visibleIds.has(active.id))) {
    return { turns: [...turns], changed: 0 };
  }
  const order = new Map([...turns].sort((a, b) => a.start - b.start).map((turn, i) => [turn.id, i]));
  let changed = 0;
  const result = turns.map(turn => {
    if (turn.id === activeId || turn.sourceSpeakerGroup !== active.sourceSpeakerGroup ||
        (options.visibleIds && !options.visibleIds.has(turn.id)) || options.protectedIds?.has(turn.id) ||
        (turn.speakerRole !== 'unknown' && turn.speakerRole !== active.speakerRole) ||
        (turn.language !== 'unknown' && turn.language !== profile.language)) return turn;
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

/** List only non-identifying source groups already recognized at import.
 * Sorting and counts refer to active cuts, not the original transcript. */
export function summarizeSourceSpeakerGroups(turns: readonly GroupTurn[]) {
  const groups = new Map<string, { id: string; count: number; pending: number }>();
  for (const turn of turns) {
    if (!turn.sourceSpeakerGroup) continue;
    const id = sourceSpeakerGroup(turn.sourceSpeakerGroup);
    if (!id) continue;
    const group = groups.get(id) ?? { id, count: 0, pending: 0 };
    group.count++;
    if (turn.speakerRole === 'unknown' || turn.language === 'unknown' ||
        studioEditorialProfile(turn.speakerRole)?.language !== turn.language) group.pending++;
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }));
}
