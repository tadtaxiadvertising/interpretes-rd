/**
 * CORS for the `/api/v1` surface.
 *
 * Deny by default: the browser UI calls these routes same-origin and needs no
 * CORS header at all. Cross-origin integrations must opt in explicitly via
 * `CORS_ORIGIN` (comma-separated list of exact origins, or `*`).
 *
 * These routes are authenticated (usually admin-only) and return candidate /
 * payroll PII, so a wildcard grant was both unnecessary and a data-exposure
 * footgun: with the previous `CORS_ORIGIN || '*'` default, any origin could
 * read the response when the env var was unset.
 */

const ALLOWED_HEADERS = 'Content-Type, Authorization';

function configuredOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Resolve the `Access-Control-Allow-Origin` value for a request origin.
 * Returns `null` (grant nothing) unless `CORS_ORIGIN` is configured and either
 * allows every origin (`*`) or explicitly lists the requesting origin.
 */
export function resolveCorsOrigin(requestOrigin: string | null | undefined): string | null {
  const allowed = configuredOrigins();
  if (allowed.length === 0) return null;
  if (allowed.includes('*')) return '*';
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  return null;
}

/**
 * Build the CORS response headers for a route handler.
 * Returns an empty object when the origin is not allowed, so the response is
 * simply not readable cross-origin (same-origin callers are unaffected).
 */
export function corsHeaders(
  request: Request,
  methods = 'GET, POST, OPTIONS'
): Record<string, string> {
  const origin = resolveCorsOrigin(request.headers.get('origin'));
  if (!origin) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    Vary: 'Origin',
  };
}
