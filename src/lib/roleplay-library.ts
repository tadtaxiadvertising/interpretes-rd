import { createHash } from 'crypto';

export interface ReusableRoleplayScenario {
  order: number;
  title: string;
  baseAudioUrl: string;
  durationLimitSec: number | null;
  scriptPrompt: string | null;
  studioTurn?: number | null;
  studioSpeaker?: string | null;
  studioLanguage?: string | null;
  sourceStartSec?: number | null;
  sourceEndSec?: number | null;
  expectedKeys?: string[];
}

/**
 * Accept only immutable base-audio objects from this project's own
 * roleplay-audio bucket. Do not reuse signed URLs, external hosts, responses,
 * or a client-supplied storage path as a trusted source.
 */
export function getReusableBaseAudioPath(audioUrl: string, supabaseUrl: string): string | null {
  try {
    // URL() normalizes both raw and percent-encoded dot-segment traversal
    // before exposing pathname, and may also treat backslashes as separators.
    // Reject them on the RAW input first. Immutable project keys are ASCII
    // and never contain encoded characters or path separator escapes.
    if (
      /%[0-9a-f]{2}/i.test(audioUrl) ||
      /\\/.test(audioUrl) ||
      /\/\.{1,2}(?:\/|[?#]|$)/.test(audioUrl)
    ) return null;
    const origin = new URL(supabaseUrl);
    const candidate = new URL(audioUrl);
    if (candidate.origin !== origin.origin || candidate.protocol !== 'https:' || candidate.search || candidate.hash) {
      return null;
    }
    const prefix = `${origin.pathname.replace(/\/$/, '')}/storage/v1/object/public/roleplay-audio/base/`;
    if (!candidate.pathname.startsWith(prefix)) return null;

    const segments = candidate.pathname.slice(prefix.length).split('/');
    // Legacy getBaseAudioPath(sessionId, ext) produces flat
    // base/<sessionId>.<ext> keys. Newer Studio imports may use nested
    // base/<uploadId>/<filename> keys. Both are first-party immutable
    // objects; never accept an empty segment, traversal or encoded key.
    if (segments.length < 1 || segments.some((part) =>
      !part || part === '.' || part === '..' || !/^[a-zA-Z0-9._-]+$/.test(part)
    )) return null;
    return `base/${segments.join('/')}`;
  } catch {
    return null;
  }
}

/** Stable snapshot identity independent of the participant or session ID. */
export function getRoleplaySnapshotHash(scenarios: ReusableRoleplayScenario[]): string {
  const sorted = [...scenarios].sort((a, b) => a.order - b.order);
  return createHash('sha256').update(JSON.stringify(sorted.map((scenario) => {
    const snapshot = {
      order: scenario.order,
      title: scenario.title,
      baseAudioUrl: scenario.baseAudioUrl,
      durationLimitSec: scenario.durationLimitSec,
      scriptPrompt: scenario.scriptPrompt,
      expectedKeys: scenario.expectedKeys ?? [],
    };
    // Keep legacy fingerprints stable when all new metadata is null; otherwise
    // archived catalog entries would silently reappear after this migration.
    const hasStudioMetadata = scenario.studioTurn != null || scenario.studioSpeaker != null ||
      scenario.studioLanguage != null || scenario.sourceStartSec != null || scenario.sourceEndSec != null;
    return hasStudioMetadata ? {
      ...snapshot,
      studioTurn: scenario.studioTurn ?? null,
      studioSpeaker: scenario.studioSpeaker ?? null,
      studioLanguage: scenario.studioLanguage ?? null,
      sourceStartSec: scenario.sourceStartSec ?? null,
      sourceEndSec: scenario.sourceEndSec ?? null,
    } : snapshot;
  }))).digest('hex');
}
