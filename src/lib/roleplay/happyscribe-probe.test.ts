// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { HAPPY_SCRIBE_PROBE_MAX_BYTES, isValidHappyScribeProbe } from './happyscribe-probe';

describe('HappyScribe administrator connectivity probe', () => {
  it('accepts the provider listing shape without copying titles to the caller', async () => {
    const body = Response.json({ results: [
      { id: 'synthetic-id', name: 'SYNTHETIC_PRIVATE_RECORD' },
    ] });
    expect(await isValidHappyScribeProbe(body)).toBe(true);
  });

  it('rejects a non-JSON successful response', async () => {
    expect(await isValidHappyScribeProbe(new Response('<html>not a valid provider API response</html>'))).toBe(false);
  });

  it('stops reading and cancels an oversized provider response', async () => {
    const cancel = vi.fn();
    const body = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(HAPPY_SCRIBE_PROBE_MAX_BYTES + 1)); },
      cancel,
    }));
    expect(await isValidHappyScribeProbe(body)).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects a declared oversized response before reading its body', async () => {
    const cancel = vi.fn();
    const body = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'Content-Length': String(HAPPY_SCRIBE_PROBE_MAX_BYTES + 1) },
    });
    expect(await isValidHappyScribeProbe(body)).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('returns a safe failure when the response body is already locked', async () => {
    const response = Response.json({ results: [] });
    const lock = response.body!.getReader();
    try { expect(await isValidHappyScribeProbe(response)).toBe(false); }
    finally { lock.releaseLock(); }
  });

  it('accepts a valid response at the bounded size limit', async () => {
    const prefix = '{"results":[],"padding":"';
    const suffix = '"}';
    const json = prefix + 'x'.repeat(HAPPY_SCRIBE_PROBE_MAX_BYTES - prefix.length - suffix.length) + suffix;
    expect(new TextEncoder().encode(json).byteLength).toBe(HAPPY_SCRIBE_PROBE_MAX_BYTES);
    expect(await isValidHappyScribeProbe(new Response(json))).toBe(true);
  });

  it('rejects corrupt UTF-8 safely', async () => {
    expect(await isValidHappyScribeProbe(new Response(new Uint8Array([0xff, 0xfe])))).toBe(false);
  });
});
