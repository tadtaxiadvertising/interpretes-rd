// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  HAPPY_SCRIBE_PROBE_MAX_BYTES, HAPPY_SCRIBE_LIST_MAX_BYTES,
  isValidHappyScribeProbe, readBoundedHappyScribeListing, readBoundedHappyScribeMetadata,
} from './happyscribe-probe';

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

  it('reads only bounded export metadata and cancels oversized bodies', async () => {
    expect(await readBoundedHappyScribeMetadata(Response.json({
      id: 'synthetic-export-id',
      state: 'ready',
    }))).toEqual({ id: 'synthetic-export-id', state: 'ready' });
    const cancel = vi.fn();
    const excessive = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(HAPPY_SCRIBE_PROBE_MAX_BYTES + 1)); },
      cancel,
    }));
    expect(await readBoundedHappyScribeMetadata(excessive)).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('reads a normal organization-scoped catalog through the bounded listing reader', async () => {
    const listing = { results: [{ id: 'synthetic-id', name: 'synthetic-title' }], _links: {} };
    expect(await readBoundedHappyScribeListing(Response.json(listing))).toEqual(listing);
  });

  it('rejects and cancels an oversized library response before JSON parsing', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(HAPPY_SCRIBE_LIST_MAX_BYTES + 1)); },
      cancel,
    }));
    expect(await readBoundedHappyScribeListing(response)).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects an oversized declared library response without consuming it', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'content-length': String(HAPPY_SCRIBE_LIST_MAX_BYTES + 1) },
    });
    expect(await readBoundedHappyScribeListing(response)).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('accepts a library response exactly at its byte limit', async () => {
    const prefix = '{"results":[],"padding":"';
    const suffix = '"}';
    const json = prefix + 'a'.repeat(HAPPY_SCRIBE_LIST_MAX_BYTES - prefix.length - suffix.length) + suffix;
    expect(new TextEncoder().encode(json).byteLength).toBe(HAPPY_SCRIBE_LIST_MAX_BYTES);
    expect(await readBoundedHappyScribeListing(new Response(json))).toMatchObject({ results: [] });
  });

  it('rejects invalid UTF-8 and locked provider bodies without leaking details', async () => {
    expect(await readBoundedHappyScribeListing(
      new Response(new Uint8Array([0xff, 0xfe])),
    )).toBeNull();
    const locked = Response.json({ results: [] });
    const lock = locked.body!.getReader();
    try {
      expect(await readBoundedHappyScribeListing(locked)).toBeNull();
    } finally {
      lock.releaseLock();
    }
  });


});
