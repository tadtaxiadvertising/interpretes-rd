/** One explicit decode/conversion at a time in this browser module.
 * Cancellation of an active task never releases its slot until the underlying
 * promise settles, because decodeAudioData cannot reliably be interrupted.
 * Waiting tasks check their signal before reading or allocating anything. */
let tail: Promise<void> = Promise.resolve();

export function withStudioDecodeSlot<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  const operation = tail.then(async () => {
    signal.throwIfAborted();
    const result = await task();
    signal.throwIfAborted();
    return result;
  });
  tail = operation.then(() => undefined, () => undefined);
  return operation;
}
