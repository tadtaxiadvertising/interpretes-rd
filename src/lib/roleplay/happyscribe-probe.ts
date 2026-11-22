/**
 * Bounded provider JSON decoding shared by the settings connection probe
 * and the organization-scoped transcription library. The normal library
 * previously used Response.json(), which could buffer an arbitrarily large
 * upstream response on a memory-constrained VPS.
 */
export const HAPPY_SCRIBE_PROBE_MAX_BYTES = 128 * 1024;
export const HAPPY_SCRIBE_LIST_MAX_BYTES = 1024 * 1024;

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown | null> {
  if (!response.body) return null;
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && /^\d+$/.test(declaredLength) &&
      Number(declaredLength) > maxBytes) {
    try { await response.body.cancel(); } catch { /* Preserve bounded failure. */ }
    return null;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = response.body.getReader(); }
  catch { return null; }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let json = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        try { await reader.cancel(); } catch { /* Preserve bounded failure. */ }
        return null;
      }
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    return JSON.parse(json) as unknown;
  } catch {
    try { await reader.cancel(); } catch { /* Do not expose provider details. */ }
    return null;
  } finally {
    reader.releaseLock();
  }
}

/** Return parsed provider metadata, or null when malformed/oversized. */
export async function readBoundedHappyScribeListing(response: Response): Promise<unknown | null> {
  return readBoundedJson(response, HAPPY_SCRIBE_LIST_MAX_BYTES);
}

/** Bounded export creation/status metadata. These steps need only IDs,
 * states and download references, never an unbounded provider payload. */
export async function readBoundedHappyScribeMetadata(response: Response): Promise<unknown | null> {
  return readBoundedJson(response, HAPPY_SCRIBE_PROBE_MAX_BYTES);
}

/** Connection checks must not expose catalog entries or download large bodies. */
export async function isValidHappyScribeProbe(response: Response): Promise<boolean> {
  const payload = await readBoundedJson(response, HAPPY_SCRIBE_PROBE_MAX_BYTES);
  return Boolean(payload && typeof payload === 'object' &&
    'results' in payload && Array.isArray(payload.results));
}
