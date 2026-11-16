import { getReusableBaseAudioPath } from '@/lib/roleplay-library';

/**
 * Refresh a first-party legacy public Storage URL for authorized admin QA.
 * Existing external/legacy assets are left unchanged for compatibility.
 *
 * The calling page must enforce admin authentication before invoking this.
 * If Storage cannot sign a recognized first-party object, never fall back to
 * a public URL that might be unavailable or expose private recording paths.
 */
export async function resolveAdminBaseAudioPlaybackUrl(
  originalUrl: string | null,
  supabaseUrl: string | undefined,
  signPath: (path: string) => Promise<string>,
): Promise<string | null> {
  if (!originalUrl) return null;
  const path = supabaseUrl
    ? getReusableBaseAudioPath(originalUrl, supabaseUrl)
    : null;
  if (path) {
    try {
      return await signPath(path);
    } catch {
      return null;
    }
  }

  // The stored URL was not validated as one of our base recordings. Never
  // render an unverified Storage URL into the admin page: it may include an
  // expired signed token or a public path from another bucket/project.
  // Check the raw URL as well as the parsed pathname; URL() normalizes raw
  // dot-segment traversal before exposing pathname.
  try {
    const asset = new URL(originalUrl);
    if (
      asset.protocol !== 'https:' ||
      originalUrl.includes('/storage/v1/object/') ||
      asset.pathname.includes('/storage/v1/object/')
    ) return null;
  } catch {
    return null;
  }

  // Preserve unrelated HTTPS legacy audio for backward compatibility.
  return originalUrl;
}
