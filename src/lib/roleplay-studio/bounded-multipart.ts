/**
 * Parse small multipart uploads with a hard limit on bytes actually read.
 *
 * Content-Length is only a fast preflight: clients can omit or lie about it.
 * A bounded TransformStream prevents Request.formData() from buffering an
 * arbitrarily large audio upload on the small Easypanel frontend container.
 */
export class MultipartBodyTooLargeError extends Error {
  constructor() {
    super('MULTIPART_BODY_TOO_LARGE');
    this.name = 'MultipartBodyTooLargeError';
  }
}

export async function readBoundedMultipartFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('INVALID_MULTIPART_BYTE_LIMIT');
  }
  if (!request.body) throw new Error('MULTIPART_BODY_REQUIRED');

  let actualBytes = 0;
  let exceededLimit = false;
  const limitedStream = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        // Avoid counting anything beyond the remaining budget: reject the
        // chunk instead of copying it into Request.formData().
        if (chunk.byteLength > maxBytes - actualBytes) {
          exceededLimit = true;
          controller.error(new MultipartBodyTooLargeError());
          return;
        }
        actualBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }),
    { signal: request.signal },
  );

  // Only content-type is needed to parse the multipart boundary. Never pass
  // along a possibly incorrect Content-Length to the internal Request.
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const internalRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: limitedStream,
    signal: request.signal,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  try {
    return await internalRequest.formData();
  } catch (error) {
    // Native multipart parsers may wrap stream errors into TypeError. Keep
    // the known size-limit outcome without leaking parser/provider details.
    if (exceededLimit) throw new MultipartBodyTooLargeError();
    throw error;
  }
}
