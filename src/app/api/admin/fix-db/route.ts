import { NextResponse } from 'next/server';

/**
 * Schema changes are deployment-managed through reviewed Prisma SQL
 * migrations and deployment preflight. This legacy endpoint previously
 * executed ALTER TABLE statements from an HTTP GET request, which made
 * database structure mutable at request time and bypassed migration history.
 *
 * Keep a 410 response for old clients/bookmarks; never run DDL from a route.
 */
function retiredSchemaPatchEndpoint() {
  return NextResponse.json(
    {
      success: false,
      error: 'This endpoint has been retired. Database changes must be delivered through reviewed migrations.',
      code: 'ENDPOINT_RETIRED',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function GET() {
  return retiredSchemaPatchEndpoint();
}

export async function POST() {
  return retiredSchemaPatchEndpoint();
}
