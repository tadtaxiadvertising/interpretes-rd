export interface ResponseAudioPaths {
  sourceAudioPath?: string | null;
  processedAudioPath?: string | null;
  sourceAudioUrl?: string | null;
  processedAudioUrl?: string | null;
}

/**
 * The storage path a reviewer should re-sign. The processed (MP3) path is
 * preferred when present, otherwise the original (source) path.
 */
export function selectResponseAudioPath(response: ResponseAudioPaths): string | null {
  return response.processedAudioPath ?? response.sourceAudioPath ?? null;
}

/**
 * Resolve a playable URL for authorized admin review.
 *
 * Prefer converted audio, with the original recording as a fallback when
 * conversion output is missing. A failed Storage signature must never fall
 * back to a stale or potentially public persisted URL when a canonical path
 * exists. Legacy rows with no path retain their original URL for compatibility.
 * The caller is responsible for admin authorization.
 */
export async function resolveResponseAudioUrl(
  response: ResponseAudioPaths,
  signPath: (path: string) => Promise<string>
): Promise<string | null> {
  const paths = [response.processedAudioPath, response.sourceAudioPath]
    .filter((path): path is string => Boolean(path));
  if (paths.length > 0) {
    for (const path of new Set(paths)) {
      try {
        return await signPath(path);
      } catch {
        // A processed file can be missing while the original still exists.
        // Never log provider details or return a previously persisted URL.
      }
    }
    return null;
  }
  return response.sourceAudioUrl ?? response.processedAudioUrl ?? null;
}
