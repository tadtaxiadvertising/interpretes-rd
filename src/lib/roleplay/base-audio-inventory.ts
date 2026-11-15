import { getReusableBaseAudioPath } from '@/lib/roleplay-library';
import type { RoleplayAudioObject } from '@/lib/roleplay/orphan-mp3-inventory';

const GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export type BaseAudioReference = {
  baseAudioUrl?: string | null;
  baseAudioPath?: string | null;
};

export type BaseAudioInventorySummary = {
  scannedBaseAudioObjects: number;
  referencedBaseAudioObjects: number;
  unverifiableBaseAudioReferences: number;
  classificationBlocked: boolean;
  unclassifiableBaseAudioObjects: number;
  unreferencedBaseAudioYoungerThan14Days: number;
  unreferencedBaseAudioUnknownAge: number;
  unreferencedBaseAudioOlderThan14Days: number;
};

// Legacy URLs must have the same origin, exact public-bucket prefix, no query
// string and an ASCII object key. Canonical keys use the same strict grammar.
function resolveBasePath(value: string, supabaseUrl: string): string | null {
  if (value.startsWith('base/')) {
    const parts = value.split('/');
    if (parts.length < 3 || parts.some((part) =>
      !part || part === '.' || part === '..' || !/^[a-zA-Z0-9._-]+$/.test(part)
    )) return null;
    return value;
  }
  return getReusableBaseAudioPath(value, supabaseUrl);
}

/**
 * Read-only diagnostics, never a deletion authorization.
 *
 * The current schema stores base audio as session URLs, scenario URLs and an
 * optional session object path. Library snapshots reuse scenario objects.
 * Unknown URL forms or Storage timestamps block all age-based classification,
 * because a path/URL that we cannot parse might still refer to an object here.
 */
export function summarizeRoleplayBaseAudioInventory(
  objects: readonly RoleplayAudioObject[],
  sessions: readonly BaseAudioReference[],
  scenarios: readonly BaseAudioReference[],
  supabaseUrl: string,
  nowMs = Date.now(),
): BaseAudioInventorySummary {
  const referenced = new Set<string>();
  let unknownReferences = 0;
  for (const entry of [...sessions, ...scenarios]) {
    for (const value of [entry.baseAudioPath, entry.baseAudioUrl]) {
      if (!value) continue; // DRAFT sessions may have an empty base URL.
      const path = resolveBasePath(value, supabaseUrl);
      if (path) referenced.add(path);
      else unknownReferences++;
    }
  }

  const unique = new Map<string, RoleplayAudioObject>();
  for (const object of objects) {
    if (!unique.has(object.path)) unique.set(object.path, object);
    else unique.set(object.path, { ...object, createdAt: null, updatedAt: null });
  }

  let protectedCount = 0;
  let young = 0;
  let unknownAge = 0;
  let aged = 0;
  for (const object of unique.values()) {
    if (referenced.has(object.path)) {
      protectedCount++;
      continue;
    }
    if (unknownReferences > 0) continue;
    const created = object.createdAt ? Date.parse(object.createdAt) : NaN;
    const updated = object.updatedAt ? Date.parse(object.updatedAt) : NaN;
    if (
      !Number.isFinite(nowMs) || !Number.isFinite(created) || !Number.isFinite(updated) ||
      created > nowMs || updated > nowMs
    ) {
      unknownAge++;
    } else if (nowMs - Math.max(created, updated) < GRACE_MS) {
      young++;
    } else {
      aged++;
    }
  }

  const blocked = unknownReferences > 0;
  return {
    scannedBaseAudioObjects: unique.size,
    referencedBaseAudioObjects: protectedCount,
    unverifiableBaseAudioReferences: unknownReferences,
    classificationBlocked: blocked,
    unclassifiableBaseAudioObjects: blocked ? unique.size - protectedCount : 0,
    unreferencedBaseAudioYoungerThan14Days: young,
    unreferencedBaseAudioUnknownAge: unknownAge,
    unreferencedBaseAudioOlderThan14Days: aged,
  };
}
