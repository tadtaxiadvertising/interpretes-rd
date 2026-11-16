/**
 * Bounded, single-consumer queue for browser-local PCM frames.
 *
 * IMPORTANT: overflowing speech audio is a data-integrity failure, not a
 * recoverable "drop oldest" event. Losing frames silently would invalidate
 * sample-based timestamps and could omit medically significant words.
 */
export class BoundedLocalPcmQueue implements AsyncIterable<Float32Array> {
  private readonly frames: Float32Array[] = [];
  private readonly maxBufferedSamples: number;
  private readonly maxFrameSamples: number;
  private pending: {
    resolve: (result: IteratorResult<Float32Array>) => void;
    reject: (reason: Error) => void;
  } | null = null;
  private closed = false;
  private terminalError: Error | null = null;
  private bufferedSamples = 0;
  private peakBufferedSamples = 0;
  private acceptedSamples = 0;

  constructor(options: { maxBufferedSamples: number; maxFrameSamples: number }) {
    if (
      !Number.isSafeInteger(options.maxBufferedSamples) ||
      !Number.isSafeInteger(options.maxFrameSamples) ||
      options.maxFrameSamples < 1 ||
      options.maxBufferedSamples < options.maxFrameSamples
    ) {
      throw new Error('INVALID_PCM_QUEUE_CAPACITY');
    }
    this.maxBufferedSamples = options.maxBufferedSamples;
    this.maxFrameSamples = options.maxFrameSamples;
  }

  getStats(): Readonly<{
    bufferedSamples: number;
    bufferedFrames: number;
    peakBufferedSamples: number;
    acceptedSamples: number;
    closed: boolean;
  }> {
    return {
      bufferedSamples: this.bufferedSamples,
      bufferedFrames: this.frames.length,
      peakBufferedSamples: this.peakBufferedSamples,
      acceptedSamples: this.acceptedSamples,
      closed: this.closed,
    };
  }

  push(frame: Float32Array): void {
    if (this.closed) throw this.terminalError ?? new Error('LOCAL_PCM_QUEUE_CLOSED');
    if (!(frame instanceof Float32Array) || !frame.length || frame.length > this.maxFrameSamples) {
      const error = new Error('INVALID_PCM_QUEUE_FRAME');
      this.fail(error);
      throw error;
    }

    // Take ownership of the data. Worklet and producers can reuse their buffer.
    const owned = frame.slice();
    if (this.pending) {
      const waiter = this.pending;
      this.pending = null;
      this.acceptedSamples += owned.length;
      waiter.resolve({ value: owned, done: false });
      return;
    }

    if (owned.length > this.maxBufferedSamples - this.bufferedSamples) {
      const error = new Error('LOCAL_PCM_QUEUE_OVERFLOW');
      this.fail(error);
      throw error;
    }
    this.frames.push(owned);
    this.acceptedSamples += owned.length;
    this.bufferedSamples += owned.length;
    this.peakBufferedSamples = Math.max(this.peakBufferedSamples, this.bufferedSamples);
  }

  /** Stop immediately. No buffered audio is emitted after explicit shutdown. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.frames.length = 0;
    this.bufferedSamples = 0;
    const waiter = this.pending;
    this.pending = null;
    waiter?.resolve({ value: undefined, done: true });
  }

  /** Stop and surface the original error to the waiting/future consumer. */
  fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.terminalError = error;
    this.frames.length = 0;
    this.bufferedSamples = 0;
    const waiter = this.pending;
    this.pending = null;
    waiter?.reject(error);
  }

  async next(): Promise<IteratorResult<Float32Array>> {
    if (this.terminalError) throw this.terminalError;
    if (this.closed) return { value: undefined, done: true };
    const next = this.frames.shift();
    if (next) {
      this.bufferedSamples -= next.length;
      return { value: next, done: false };
    }
    if (this.pending) throw new Error('LOCAL_PCM_QUEUE_CONCURRENT_READ');
    return new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
  }

  [Symbol.asyncIterator](): AsyncIterator<Float32Array> {
    return {
      next: () => this.next(),
      return: async () => {
        this.close();
        return { value: undefined, done: true };
      },
    };
  }
}
