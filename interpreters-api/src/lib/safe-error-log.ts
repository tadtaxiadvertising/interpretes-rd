/**
 * Allowlist-only operational event for Easypanel logs.
 * Exceptions, HTTP URLs, query parameters, user identifiers and stack traces
 * must never be serialized here: those values can contain credentials or PII.
 */
const allowedCategories = new Set([
  'VALIDATION_ERROR',
  'APPLICATION_ERROR',
  'PRISMA_REQUEST',
  'PRISMA_VALIDATION',
  'PRISMA_INITIALIZATION',
  'JSON_PARSE_ERROR',
  'UNHANDLED_REQUEST_ERROR',
]);

const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export function formatSafeApiErrorLog(
  method: string | undefined,
  category: string,
  statusCode: number,
): string {
  const safeCategory = allowedCategories.has(category) ? category : 'UNCLASSIFIED_ERROR';
  const safeMethod = method && allowedMethods.has(method) ? method : 'OTHER';
  const safeStatus = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;

  return JSON.stringify({
    timestamp: new Date().toISOString(),
    category: safeCategory,
    method: safeMethod,
    statusCode: safeStatus,
  });
}
