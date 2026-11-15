/**
 * Browser credentialed CORS policy. Never trust an alternate legacy domain
 * when the canonical FRONTEND_ORIGIN configuration is missing.
 *
 * A browser's Origin header must be a serialized origin (no path, credentials,
 * query or fragment), and the configured origin must be HTTPS in production.
 */
function parsedOrigin(value: string | null | undefined, production: boolean): URL | null {
  if (!value || /[\s\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && !production)) ||
        url.origin !== value.replace(/\/$/, '')) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function trustedCorsOrigin(
  requestOrigin: string | null,
  configuredOrigin: string | undefined,
  production: boolean,
): string | null {
  const candidate = parsedOrigin(requestOrigin, production);
  if (!candidate) return null;

  const configured = parsedOrigin(configuredOrigin, production);
  if (configured && candidate.origin === configured.origin) return candidate.origin;

  // Development accepts loopback browser ports only, never hostname substring
  // matches like evil-localhost.example or customer-localhost.example.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(candidate.hostname);
  if (!production && local) return candidate.origin;

  return null;
}

/** Preserve existing Vary values (especially Cookie/Authorization). */
export function addCorsVary(headers: Headers): void {
  const existing = headers.get('Vary');
  const parts = existing?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  if (!parts.some(part => part.toLowerCase() === 'origin')) {
    headers.set('Vary', [...parts, 'Origin'].join(', '));
  }
}
