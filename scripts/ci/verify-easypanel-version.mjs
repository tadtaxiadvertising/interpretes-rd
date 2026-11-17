import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function versionEndpoint(rawUrl) {
  if (!rawUrl || /[\s\x00-\x1f\x7f]/.test(rawUrl)) {
    throw new Error('The release verification URL is missing or invalid.');
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('The release verification URL is invalid.');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.search || url.hash || !['/', '/api/version'].includes(url.pathname)) {
    throw new Error('Release verification requires a clean HTTPS origin or /api/version URL.');
  }
  url.pathname = '/api/version';
  return url.toString();
}

/** Fail closed: a successful webhook or healthy server is not a matching release. */
export async function verifyEasypanelVersion({
  baseUrl, expectedSha, attempts = 18, intervalMs = 10_000,
  fetchFn = fetch, sleepFn = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const endpoint = versionEndpoint(baseUrl);
  if (!SHA_PATTERN.test(expectedSha ?? '')) {
    throw new Error('Expected release SHA must be the complete 40-character Git commit.');
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60) {
    throw new Error('Invalid release verification retry budget.');
  }
  let lastReason = 'not_reachable';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchFn(endpoint, {
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) {
        const body = await response.json();
        if (body && typeof body === 'object' && body.buildId === expectedSha) {
          return { sha: expectedSha, attempt };
        }
        lastReason = typeof body?.buildId === 'string' && SHA_PATTERN.test(body.buildId)
          ? 'running_different_sha' : 'missing_valid_provenance';
      } else {
        lastReason = 'http_error';
      }
    } catch {
      // Do not log URLs, credentials or upstream response bodies.
      lastReason = 'unreachable_or_invalid_json';
    }
    if (attempt < attempts) await sleepFn(intervalMs);
  }
  throw new Error(`Easypanel release SHA not verified after ${attempts} attempts (${lastReason}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyEasypanelVersion({
      baseUrl: process.env.EASYPANEL_RELEASE_VERIFY_URL,
      expectedSha: process.env.EXPECTED_GIT_SHA,
    });
    const message = `Verified running Easypanel frontend SHA: ${result.sha} (attempt ${result.attempt})`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
    }
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : 'Release verification failed.'}`);
    process.exitCode = 1;
  }
}
