/**
 * Parse multipart uploads with a hard limit on bytes actually read and an
 * optional idle deadline. Content-Length is not authoritative.
 */
export class MultipartBodyTooLargeError extends Error {
  constructor() {
    super('MULTIPART_BODY_TOO_LARGE');
    this.name = 'MultipartBodyTooLargeError';
  }
}

export class MultipartBodyIdleTimeoutError extends Error {
  constructor() {
    super('MULTIPART_BODY_IDLE_TIMEOUT');
    this.name = 'MultipartBodyIdleTimeoutError';
  }
}

export async function readBoundedMultipartFormData(
  request: Request,
  maxBytes: number,
  idleTimeoutMs?: number,
): Promise<FormData> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('INVALID_MULTIPART_BYTE_LIMIT');
  }
  if (idleTimeoutMs !== undefined && (!Number.isSafeInteger(idleTimeoutMs) ||
      idleTimeoutMs < 1 || idleTimeoutMs > 2_147_483_647)) {
    throw new Error('INVALID_MULTIPART_IDLE_TIMEOUT');
  }
  if (!request.body) throw new Error('MULTIPART_BODY_REQUIRED');

  let actualBytes = 0;
  let exceededLimit = false;
  let timedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const clearIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const resetIdleTimer = (controller: TransformStreamDefaultController<Uint8Array>) => {
    clearIdleTimer();
    if (idleTimeoutMs === undefined) return;
    idleTimer = setTimeout(() => {
      timedOut = true;
      // Error the downstream reader directly, even if upstream cancellation
      // is delayed. The pipe also propagates the error to the source.
      controller.error(new MultipartBodyIdleTimeoutError());
    }, idleTimeoutMs);
  };

  try {
    const limitedStream = request.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        start(controller) {
          resetIdleTimer(controller);
        },
        transform(chunk, controller) {
          if (chunk.byteLength > maxBytes - actualBytes) {
            exceededLimit = true;
            clearIdleTimer();
            controller.error(new MultipartBodyTooLargeError());
            return;
          }
          actualBytes += chunk.byteLength;
          // Empty chunks are not progress; slow but active uploads are.
          if (chunk.byteLength > 0) resetIdleTimer(controller);
          controller.enqueue(chunk);
        },
        flush() {
          clearIdleTimer();
        },
      }),
      { signal: request.signal },
    );

    // Only content-type is needed for multipart parsing; never forward a
    // potentially incorrect Content-Length to the internal Request.
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
    return await internalRequest.formData();
  } catch (error) {
    // Native parsers may wrap stream errors in TypeError.
    if (exceededLimit) throw new MultipartBodyTooLargeError();
    if (timedOut) throw new MultipartBodyIdleTimeoutError();
    throw error;
  } finally {
    clearIdleTimer();
  }
}
