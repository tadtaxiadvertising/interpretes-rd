const OFFICIAL_FRONTEND = 'https://interpretes.rd.ibusiness.com.do';

/**
 * CORS controls browser access; authentication still protects every endpoint.
 * Production must never reflect arbitrary Origin headers when env is absent.
 */
export function resolveAllowedCorsOrigins(raw: string | undefined, isProduction: boolean): string[] {
  const values = (raw ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!values.length) {
    // Preserve local development ergonomics only outside production.
    return isProduction ? [OFFICIAL_FRONTEND] : [];
  }

  const valid = values.map(value => {
    if (/[\u0000-\u001f\u007f\s]/u.test(value) || value === '*' || value === 'null') {
      throw new Error('CORS_ORIGINS_INVALID');
    }
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error('CORS_ORIGINS_INVALID'); }
    const localDev = !isProduction && url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    if (!((url.protocol === 'https:') || localDev) ||
        value !== url.origin || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new Error('CORS_ORIGINS_INVALID');
    }
    return url.origin;
  });
  return [...new Set(valid)];
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  configuredOrigins: readonly string[],
  isProduction: boolean,
): boolean {
  if (!origin) return true; // Non-browser callers, health probes.
  if (!configuredOrigins.length) return !isProduction;
  return configuredOrigins.includes(origin);
}
