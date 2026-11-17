import { NextResponse } from 'next/server';

/**
 * HEALTH CHECK — /api/health
 * ============================================================
 * MISSION: Keep the Easypanel/Traefik container alive.
 *
 * DESIGN:
 *   1. `force-dynamic` prevents Next.js from caching this as a
 *      static page during the build phase.
 *   2. Returns 200 with `{ status: "healthy" }` unconditionally.
 *      This is a PURE liveness probe — no DB, no I/O, no auth.
 *   3. The health endpoint is bypassed by the middleware (no auth,
 *      no Supabase session refresh, no CORS overhead).
 *   4. Database connectivity should be checked via a separate
 *      readiness probe, NOT the liveness healthcheck. Coupling
 *      DB state to container liveness causes cascading restarts
 *      during transient DB hiccups (the #1 cause of SIGTERM loops).
 *
 * EASYPANEL CONFIG:
 *   Health Check Path: /api/health
 *   Health Check Port: 80
 *   Interval: 30s | Timeout: 5s | Start Period: 15s | Retries: 3
 * ============================================================
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'interpretes-rd',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}
