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
  const buildTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(rawTimestamp)
    && !Number.isNaN(Date.parse(rawTimestamp)) ? rawTimestamp : null;

  return NextResponse.json(
    { buildTimestamp, buildId },
    { status: 200, headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
