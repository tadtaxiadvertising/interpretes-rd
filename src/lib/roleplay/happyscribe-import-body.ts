/**
 * SRT imports accept only a transcription ID and its short signed proof.
 * Reject anomalously large bodies before JSON.parse so malformed clients
 * cannot allocate unbounded memory on the shared Next.js VPS.
 */
export const MAX_HAPPYSCRIBE_IMPORT_BODY_BYTES = 8 * 1024;

export type HappyScribeImportBody =
  | { kind: 'ok'; value: unknown }
  | { kind: 'invalid' | 'too-large' };

export async function readBoundedHappyScribeImportBody(request: Request): Promise<HappyScribeImportBody> {
  const body = request.body;
  if (!body) return { kind: 'invalid' };

  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) &&
      Number(declared) > MAX_HAPPYSCRIBE_IMPORT_BODY_BYTES) {
    try { await body.cancel(); } catch { /* Preserve size-limit failure. */ }
    return { kind: 'too-large' };
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = body.getReader(); }
  catch { return { kind: 'invalid' }; }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HAPPYSCRIBE_IMPORT_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* Preserve size-limit failure. */ }
        return { kind: 'too-large' };
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const json = new TextDecoder('utf-8', { fatal: true }).decode(merged);
    return { kind: 'ok', value: JSON.parse(json) as unknown };
  } catch {
    try { await reader.cancel(); } catch { /* Never log request contents. */ }
    return { kind: 'invalid' };
  } finally {
    reader.releaseLock();
  }
}
