const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// HappyScribe may return signed AWS S3 URLs. Restrict the AWS allowlist to
// S3 object storage; other AWS services are not legitimate export hosts.
const S3_REGION = '[a-z]{2}(?:-gov)?-[a-z]+-[0-9]';
const S3_HOST = new RegExp(
  '^(?:[a-z0-9][a-z0-9.-]{0,200}\\.)?s3' +
    '(?:\\.' + S3_REGION + '|-' + S3_REGION +
    '|\\.dualstack\\.' + S3_REGION +
    '|-accelerate(?:\\.dualstack)?|-external-1)?\\.amazonaws\\.com' + '$',
);

/**
 * Release an upstream response we will never forward to the browser.
 * Failure to cancel an already-rejected response must not alter the proper
 * HTTP status (e.g. 413 for size-limit rejections).
 */
export async function discardHappyScribeDownload(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort connection cleanup, never expose signed URLs or upstream details.
  }
}

/** Only provider endpoints or its AWS object storage, never private addresses. */
export function isAllowedHappyScribeExportUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password &&
    (url.port === '' || url.port === '443') &&
    (host === 'happyscribe.com' ||
      host.endsWith('.happyscribe.com') ||
      S3_HOST.test(host));
}

/**
 * Node.js fetch follows redirects automatically by default. Validate EVERY
 * redirect before making the next request; a valid initial provider URL must
 * not be able to redirect an internal service request to an arbitrary host.
 *
 * No provider API tokens are ever sent in these download requests.
 */
export async function fetchHappyScribeExport(
  startingUrl: string,
  signal: AbortSignal,
): Promise<Response> {
  let url = new URL(startingUrl);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!isAllowedHappyScribeExportUrl(url)) {
      throw new Error('Untrusted HappyScribe export destination');
    }
    const response = await fetch(url, {
      cache: 'no-store',
      signal,
      redirect: 'manual',
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    if (!location || redirects === 3) {
      throw new Error('Invalid HappyScribe export redirect');
    }
    url = new URL(location, url);
  }
  throw new Error('HappyScribe export exceeded redirect limit');
}
