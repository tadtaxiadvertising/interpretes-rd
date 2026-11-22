// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_HAPPYSCRIBE_IMPORT_BODY_BYTES, readBoundedHappyScribeImportBody,
} from './happyscribe-import-body';

describe('HappyScribe SRT import request body bound', () => {
  it('accepts a short signed import request', async () => {
    const value = { id: 'a'.repeat(32), proof: '1234567890123.' + 'f'.repeat(64) };
    const request = new Request('https://interpretes.example/api/admin/happyscribe/transcriptions', {
      method: 'POST', body: JSON.stringify(value),
    });
    expect(await readBoundedHappyScribeImportBody(request))
      .toEqual({ kind: 'ok', value });
  });

  it('accepts a JSON body at the exact 8 KiB limit', async () => {
    const prefix = '{"padding":"';
    const suffix = '"}';
    const content = prefix + 'x'.repeat(MAX_HAPPYSCRIBE_IMPORT_BODY_BYTES - prefix.length - suffix.length) + suffix;
    expect(new TextEncoder().encode(content).byteLength).toBe(MAX_HAPPYSCRIBE_IMPORT_BODY_BYTES);
    const request = new Request('https://interpretes.example', { method: 'POST', body: content });
    expect((await readBoundedHappyScribeImportBody(request)).kind).toBe('ok');
  });

  it('cancels an oversized declared request without decoding its JSON', async () => {
    const cancel = vi.fn();
    const request = new Request('https://interpretes.example', {
      method: 'POST',
      headers: { 'Content-Length': String(MAX_HAPPYSCRIBE_IMPORT_BODY_BYTES + 1) },
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: 'half',
    } as RequestInit);
    expect(await readBoundedHappyScribeImportBody(request)).toEqual({ kind: 'too-large' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels chunked requests once the body exceeds the limit', async () => {
    const cancel = vi.fn();
    const request = new Request('https://interpretes.example', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"proof":"'));
          controller.enqueue(new Uint8Array(MAX_HAPPYSCRIBE_IMPORT_BODY_BYTES + 1));
        },
        cancel,
      }),
      duplex: 'half',
    } as RequestInit);
    expect(await readBoundedHappyScribeImportBody(request)).toEqual({ kind: 'too-large' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not leak invalid JSON or decode malformed UTF-8', async () => {
    const invalid = new Request('https://interpretes.example', { method: 'POST', body: '{ "proof":"SYNTHETIC_SECRET"' });
    const badUtf8 = new Request('https://interpretes.example', { method: 'POST', body: new Uint8Array([0xff, 0xfe]) });
    expect(await readBoundedHappyScribeImportBody(invalid)).toEqual({ kind: 'invalid' });
    expect(await readBoundedHappyScribeImportBody(badUtf8)).toEqual({ kind: 'invalid' });
  });
});
