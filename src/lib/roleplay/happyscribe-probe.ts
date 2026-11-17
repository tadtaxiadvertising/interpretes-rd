/**
 * Read only a bounded response for the HappyScribe settings connectivity test.
 * Even if an upstream proxy ignores per_page=1, it must not force the VPS
 * to buffer an unbounded transcription catalog.
 */
export const HAPPY_SCRIBE_PROBE_MAX_BYTES = 128 * 1024;

export async function isValidHappyScribeProbe(response: Response): Promise<boolean> {
  if (!response.body) return false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let json = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > HAPPY_SCRIBE_PROBE_MAX_BYTES) {
        try { await reader.cancel(); } catch { /* Keep the probe failure result. */ }
        return false;
      }
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    const payload: unknown = JSON.parse(json);
    return Boolean(payload && typeof payload === 'object' &&
      'results' in payload && Array.isArray(payload.results));
  } catch {
    try { await reader.cancel(); } catch { /* Avoid leaking upstream failures. */ }
    return false;
  } finally {
    reader.releaseLock();
  }
}
