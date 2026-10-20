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
 * Resolve a playable URL for admin review.
 *
 * A stored path is re-signed on demand so playback does not depend on the
 * short-lived signed URL captured at submission time. If there is no stored
 * path (legacy rows) or signing fails, fall back to the persisted URL.
 */
export async function resolveResponseAudioUrl(
  response: ResponseAudioPaths,
  signPath: (path: string) => Promise<string>
): Promise<string | null> {
  const path = selectResponseAudioPath(response);
  if (path) {
    try {
      return await signPath(path);
    } catch {
      // fall through to the persisted URL (may be expired)
    }
  }
  return response.sourceAudioUrl ?? response.processedAudioUrl ?? null;
}
