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
  if (!path) return originalUrl;
  try {
    return await signPath(path);
  } catch {
    return null;
  }
}
