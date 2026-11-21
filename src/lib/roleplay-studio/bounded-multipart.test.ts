// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { MultipartBodyTooLargeError, readBoundedMultipartFormData } from './bounded-multipart';

const url = 'http://localhost/api/admin/roleplays/studio/silences';

function formRequest(size = 4): Request {
  const form = new FormData();
  form.append('audio', new File([new Uint8Array(size)], 'fixture.mp3', {
    type: 'audio/mpeg',
  }));
  return new Request(url, { method: 'POST', body: form });
}

describe('bounded multipart form decoding', () => {
  it('parses a small valid multipart upload without changing its file', async () => {
    const request = formRequest(8);
    const result = await readBoundedMultipartFormData(request, 1024);
    const file = result.get('audio');
    expect(file).toBeInstanceOf(File);
    expect((file as File).size).toBe(8);
  });

  it('rejects actual bytes even when Content-Length is missing or understated', async () => {
    const request = formRequest(2048);
    request.headers.set('content-length', '1');
    await expect(readBoundedMultipartFormData(request, 1024))
      .rejects.toBeInstanceOf(MultipartBodyTooLargeError);
  });

  it('rejects and cancels a streaming upload that exceeds the byte cap', async () => {
    const cancel = vi.fn();
    const boundary = 'synthetic-boundary';
    const prefix = new TextEncoder().encode(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="audio"; filename="test.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n',
    );
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(prefix);
        controller.enqueue(new Uint8Array(2048));
      },
      cancel,
    });
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
      body: source,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await expect(readBoundedMultipartFormData(request, 1024))
      .rejects.toBeInstanceOf(MultipartBodyTooLargeError);
    // Cancellation may occur asynchronously when pipeThrough propagates error.
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it('does not disclose malformed multipart contents or parse unlimited fields', async () => {
    const malformed = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=missing' },
      body: 'private-synthetic-token',
    });
    await expect(readBoundedMultipartFormData(malformed, 1024)).rejects.toThrow();
  });

  it('rejects invalid resource budgets before consuming the body', async () => {
    const request = formRequest();
    await expect(readBoundedMultipartFormData(request, 0)).rejects.toThrow('INVALID_MULTIPART_BYTE_LIMIT');
    expect(request.bodyUsed).toBe(false);
  });
});
