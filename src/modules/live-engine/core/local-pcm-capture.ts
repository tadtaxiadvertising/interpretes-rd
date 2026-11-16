import { BoundedLocalPcmQueue } from './bounded-pcm-queue';

/**
 * Explicitly started from a user action, and never attached to the page on load.
 * Captures microphone PCM in the browser without recording or uploading it.
 *
 * Consumers should use `chunkLocalPcmFrames(capture.frames, { sampleRate:
 * capture.sampleRate })` only after deciding how to handle sample-rate conversion,
 * model latency and queue overflow. This capture source does not run ASR.
 */
export interface LocalPcmCapture {
  readonly sampleRate: number;
  readonly frames: AsyncIterable<Float32Array>;
  getStats(): ReturnType<BoundedLocalPcmQueue['getStats']>;
  stop(): void;
}

export async function startLocalPcmCapture(
  options: { signal?: AbortSignal } = {},
): Promise<LocalPcmCapture> {
  if (
    typeof window === 'undefined' ||
    !window.isSecureContext ||
    typeof AudioContext === 'undefined' ||
    typeof AudioWorkletNode === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new Error('LOCAL_PCM_CAPTURE_UNSUPPORTED');
  }
  if (options.signal?.aborted) throw new Error('LOCAL_PCM_CAPTURE_CANCELLED');

  let stopped = false;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;
  let queue: BoundedLocalPcmQueue | null = null;

  const onEnded = () => cleanup(new Error('LOCAL_PCM_MICROPHONE_ENDED'));
  const onAbort = () => cleanup(new Error('LOCAL_PCM_CAPTURE_CANCELLED'));

  function cleanup(error?: Error) {
    if (stopped) return;
    stopped = true;
    options.signal?.removeEventListener('abort', onAbort);
    if (queue) {
      if (error) queue.fail(error);
      else queue.close();
    }
    if (node) {
      node.port.onmessage = null;
      node.onprocessorerror = null;
      try { node.port.postMessage({ type: 'stop' }); } catch { /* processor may already be gone */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
      node.port.close();
    }
    if (source) {
      try { source.disconnect(); } catch { /* already disconnected */ }
    }
    stream?.getAudioTracks().forEach(track => track.removeEventListener('ended', onEnded));
    stream?.getTracks().forEach(track => track.stop());
    if (context) void context.close().catch(() => { /* browser is closing */ });
  }

  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // This permission request is not abortable. If the user cancels while the
    // browser prompt is open, immediately release any stream granted later.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true },
      video: false,
    });
    if (stopped || options.signal?.aborted) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('LOCAL_PCM_CAPTURE_CANCELLED');
    }

    stream.getAudioTracks().forEach(track => track.addEventListener('ended', onEnded, { once: true }));
    context = new AudioContext({ latencyHint: 'interactive' });
    if (!context.audioWorklet?.addModule) throw new Error('LOCAL_PCM_WORKLET_UNAVAILABLE');

    // Loaded from our own public assets, never an external CDN.
    await context.audioWorklet.addModule('/live-pcm-capture-worklet.js');
    if (stopped || options.signal?.aborted) throw new Error('LOCAL_PCM_CAPTURE_CANCELLED');

    // Maximum of two seconds of queued frames. Beyond this limit, stop
    // explicitly instead of silently dropping words or corrupting offsets.
    queue = new BoundedLocalPcmQueue({
      maxBufferedSamples: Math.max(1024, Math.ceil(context.sampleRate * 2)),
      maxFrameSamples: 1024,
    });
    source = context.createMediaStreamSource(stream);
    // The processor itself must have a bounded number of in-flight messages;
    // a JavaScript queue alone cannot bound pending MessagePort messages.
    const packetCredits = Math.min(256, Math.max(1, Math.ceil(context.sampleRate * 2 / 1024)));
    node = new AudioWorkletNode(context, 'free-interpreters-live-pcm', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { packetCredits },
    });

    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (stopped || !queue) return;
      const data = event.data as { type?: unknown; samples?: unknown } | null;
      if (data?.type === 'overflow') {
        cleanup(new Error('LOCAL_PCM_TRANSPORT_OVERFLOW'));
        return;
      }
      if (data?.type !== 'pcm' || !(data.samples instanceof Float32Array)) {
        cleanup(new Error('INVALID_LOCAL_PCM_MESSAGE'));
        return;
      }
      try {
        queue.push(data.samples);
      } catch (cause) {
        cleanup(cause instanceof Error ? cause : new Error('LOCAL_PCM_QUEUE_ERROR'));
      }
    };
    node.onprocessorerror = () => cleanup(new Error('LOCAL_PCM_PROCESSOR_FAILED'));

    source.connect(node);
    // The worklet explicitly outputs zeros so connecting to the destination
    // does not create any microphone loopback or audible feedback.
    node.connect(context.destination);
    await context.resume();
    if (stopped || options.signal?.aborted) throw new Error('LOCAL_PCM_CAPTURE_CANCELLED');

    const activeQueue = queue;
    const sampleRate = context.sampleRate;
    return {
      sampleRate,
      // Return credits only after the consumer actually moves to the next
      // frame. This bounds Worklet->main-thread messages even if ASR stalls.
      frames: {
        async *[Symbol.asyncIterator]() {
          for await (const frame of activeQueue) {
            yield frame;
            if (!stopped) node?.port.postMessage({ type: 'credit' });
          }
        },
      },
      getStats: () => activeQueue.getStats(),
      stop: () => cleanup(),
    };
  } catch (cause) {
    cleanup(cause instanceof Error ? cause : new Error('LOCAL_PCM_CAPTURE_FAILED'));
    throw cause;
  }
}
