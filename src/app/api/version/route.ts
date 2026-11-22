import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Deployment provenance is unknown unless the runtime receives explicit build
 * metadata. Never synthesize a new timestamp per request: doing so makes an
 * unchanged container appear to be a different release.
 */
export async function GET() {
  // This endpoint is public. Never reflect arbitrary environment contents:
  // a misconfigured build argument may accidentally contain private data.
  // The read-only Easypanel verifier already requires a full 40-hex SHA.
  const rawSha = process.env.GIT_SHA?.trim() ?? '';
  const buildId = /^[a-f0-9]{40}$/i.test(rawSha) ? rawSha.toLowerCase() : null;
  const rawTimestamp = process.env.BUILD_TIMESTAMP?.trim() ?? '';
  // Only publish an ISO UTC build time, not arbitrary deployment metadata.
  const isoUtcShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(rawTimestamp);
  const parsedTime = isoUtcShape ? Date.parse(rawTimestamp) : NaN;
  // Date.parse normalizes impossible calendar dates (e.g. Feb 30 -> Mar 2)
  // and 24:00:00 instead of rejecting them. Verify the UTC calendar/time
  // prefix survives parsing unchanged before reporting public provenance.
  const buildTimestamp = Number.isFinite(parsedTime) &&
    new Date(parsedTime).toISOString().slice(0, 19) === rawTimestamp.slice(0, 19)
    ? rawTimestamp : null;

  return NextResponse.json(
    { buildTimestamp, buildId },
    { status: 200, headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
