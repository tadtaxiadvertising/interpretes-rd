import { z } from 'zod';

// bcrypt ignores UTF-8 bytes beyond 72. Reject new credentials instead of
// silently hashing only a prefix. Do not apply this to legacy login input.
// https://github.com/kelektiv/node.bcrypt.js#security-issues-and-concerns
export const newBcryptPasswordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .refine(password => Buffer.byteLength(password, 'utf8') <= 72, {
    message: 'Password must be at most 72 UTF-8 bytes',
  });
