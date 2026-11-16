import { getReusableBaseAudioPath } from '@/lib/roleplay-library';

type InvitationAudioSession = {
  baseAudioPath?: string | null;
  baseAudioUrl?: string | null;
};

function canonicalBasePath(value: string): string | null {
  const segments = value.split('/');
  // Some older sessions store a flat base/<filename> object key.
  if (segments.length < 2 || segments[0] !== 'base') return null;
  if (segments.some((segment) =>
    !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment)
  )) return null;
  return value;
}

/**
 * Resolve playback data only AFTER an invitation was authorized and bound.
 *
 * Preserve external legacy URLs but never hand back an untrusted first-party
 * Storage URL if strict canonical resolution fails. An error signing a known
 * object is not an invitation validation failure; the caller may still load
 * its session and retry playback through the authorized session GET endpoint.
 */
export async function resolveInvitationBaseAudioUrl(
  session: InvitationAudioSession,
  projectUrl: string | undefined,
  signPath: (path: string, expiresIn: number) => Promise<string>,
): Promise<string | null> {
  const storedUrl = session.baseAudioUrl || null;
  const storedPath = session.baseAudioPath;
  if (storedPath) {
    const path = canonicalBasePath(storedPath);
    if (!path) return null;
    try {
      return await signPath(path, 60 * 60);
    } catch {
      return null;
    }
  }

  if (!storedUrl) return null;
  if (!projectUrl) {
    // Without the configured project origin we cannot confirm ownership of
    // any Storage object. Never return a persisted Storage URL which may
    // contain a historical signing token or point to a public recording.
    // Retain only ordinary non-Storage legacy assets for compatibility.
    try {
      const asset = new URL(storedUrl);
      // URL() normalizes raw traversal such as /storage/v1/object/../audio
      // before exposing pathname. Inspect BOTH representations and reject
      // non-HTTPS schemes without depending on origin configuration.
      if (
        asset.protocol !== 'https:' ||
        storedUrl.includes('/storage/v1/object/') ||
        asset.pathname.includes('/storage/v1/object/')
      ) return null;
    } catch {
      return null;
    }
    return storedUrl;
  }

  const path = getReusableBaseAudioPath(storedUrl, projectUrl);
  if (path) {
    try {
      return await signPath(path, 60 * 60);
    } catch {
      return null;
    }
  }

  try {
    const project = new URL(projectUrl);
    const asset = new URL(storedUrl);
    // Prevent unrecognized, signed, or malformed same-project bucket links
    // from bypassing short-lived signing in the invitation response.
    if (asset.origin === project.origin && (
      storedUrl.includes('/storage/v1/object/') ||
      asset.pathname.includes('/storage/v1/object/')
    )) return null;
  } catch {
    return null;
  }

  // Legacy third-party audio is outside this bucket's signing authority.
  return storedUrl;
}
