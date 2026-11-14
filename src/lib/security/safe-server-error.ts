/**
 * Do not log arbitrary error objects, .message, .stack or .name.
 * Prisma/Storage errors can contain DB credentials and signed audio URLs.
 */
export function safeServerErrorCategory(error: unknown): 'Error' | 'UnknownError' {
  return error instanceof Error ? 'Error' : 'UnknownError';
}
