import { z } from 'zod';

/** FormData and CSV values arrive as strings; an empty string must not become zero. */
export const nonNegativeIntegerInput = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().nonnegative().max(100000000));
