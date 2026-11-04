const PUBLIC_API_EXACT_PATHS = new Set([
  '/api/health',
  '/api/version',
  '/api/roleplay/validate-invite',
  '/api/roleplay/validate-invite-by-code',
  '/api/roleplay/start',
]);

const PUBLIC_API_PREFIXES = ['/api/auth/', '/api/webhooks/', '/api/cron/'] as const;

/**
 * Match only explicitly public endpoints. Roleplay routes are exact paths so
 * adding a new session/audio endpoint cannot silently inherit public access.
 */
export function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_EXACT_PATHS.has(pathname) ||
    PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
