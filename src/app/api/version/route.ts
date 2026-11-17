import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Deployment provenance is unknown unless the runtime receives explicit build
 * metadata. Never synthesize a new timestamp per request: doing so makes an
 * unchanged container appear to be a different release.
 */
export async function GET() {
  const buildTimestamp = process.env.BUILD_TIMESTAMP?.trim() || null;
  const buildId = process.env.GIT_SHA?.trim() || null;

  return NextResponse.json(
    { buildTimestamp, buildId },
    { status: 200, headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
