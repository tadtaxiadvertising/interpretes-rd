import { AppError } from './AppError.js';

// Limit native password work per API process. No waiting queue: excess work
// must not accumulate in libuv while a small VPS is under pressure.
export function createPasswordWorkGate(maxConcurrent: number) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error('Invalid password concurrency budget');
  }
  let active = 0;
  return async function withPasswordWork<T>(work: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      throw new AppError('Password service temporarily busy', 503);
    }
    active++;
    try {
      return await work();
    } finally {
      // Keep the slot until the actual native operation settles, even if the
      // HTTP caller disconnected. Do not release on request/socket close.
      active--;
    }
  };
}

// Conservative budget for the existing small API container. Shared by all
// login and new-account hashing paths in this process; not a rate limiter.
export const withPasswordWork = createPasswordWorkGate(2);
