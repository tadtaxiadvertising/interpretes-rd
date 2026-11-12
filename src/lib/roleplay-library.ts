import { createHash } from 'crypto';

export interface ReusableRoleplayScenario {
  order: number;
  title: string;
  baseAudioUrl: string;
  durationLimitSec: number | null;
  scriptPrompt: string | null;
  expectedKeys?: string[];
}

/**
 * Accept only immutable base-audio objects from this project's own
 * roleplay-audio bucket. Do not reuse signed URLs, external hosts, responses,
 * or a client-supplied storage path as a trusted source.
 */
export function getReusableBaseAudioPath(audioUrl: string, supabaseUrl: string): string | null {
  try {
    const origin = new URL(supabaseUrl);
    const candidate = new URL(audioUrl);
    if (candidate.origin !== origin.origin || candidate.protocol !== 'https:' || candidate.search || candidate.hash) {
      return null;
    }
    const prefix = `${origin.pathname.replace(/\/$/, '')}/storage/v1/object/public/roleplay-audio/base/`;
    if (!candidate.pathname.startsWith(prefix)) return null;

    const segments = candidate.pathname.slice(prefix.length).split('/');
    if (segments.length < 2 || segments.some((part) =>
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
  return createHash('sha256').update(JSON.stringify(sorted.map((scenario) => ({
    order: scenario.order,
    title: scenario.title,
    baseAudioUrl: scenario.baseAudioUrl,
    durationLimitSec: scenario.durationLimitSec,
    scriptPrompt: scenario.scriptPrompt,
    expectedKeys: scenario.expectedKeys ?? [],
  })))).digest('hex');
}
