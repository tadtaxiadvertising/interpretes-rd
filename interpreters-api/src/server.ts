import http from 'node:http';
import app from './app.js';
import { ENV } from './config/env.js';
import { warmupPrisma, disconnectPrisma } from './lib/prisma.js';

/**
 * SERVER ENTRYPOINT — interpreters-api
 * ============================================================
 * Production-grade startup with:
 *   1. Prisma connection warmup (fail-fast if DB is unreachable).
 *   2. HTTP timeouts to prevent zombie connections on the VPS.
 *   3. Graceful shutdown: drain in-flight requests before exit.
 *   4. Process-level crash guards (unhandledRejection, uncaughtException).
 *
 * MEMORY BUDGET: ~100MB heap (NODE_OPTIONS in Dockerfile).
 * CONNECTION BUDGET: 3 Prisma pool slots (Supabase Free Tier).
 * ============================================================
 */

const PORT = Number(ENV.PORT) || 3000;
const SHUTDOWN_TIMEOUT_MS = 10_000; // 10s max to drain connections

// ── 1. Process-Level Crash Guards ────────────────────────────
// These prevent the container from dying silently.
// Errors are logged so Easypanel's log viewer captures them.

process.on('unhandledRejection', (_reason: unknown) => {
  // Process-level exceptions may include database URLs or bearer credentials.
  // Retain a stable category, never serialize the exception or its stack.
  console.error('UNHANDLED_REJECTION');
  // Do NOT crash — let the error handler middleware deal with request errors.
  // Only truly fatal rejections (DB down) should trigger a restart via health check.
});

process.on('uncaughtException', (_err: Error) => {
  console.error('UNCAUGHT_EXCEPTION_FATAL');
  // Uncaught exceptions leave the process in an undefined state.
  // Graceful shutdown, then let Easypanel restart the container.
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});


// ── 2. Create HTTP Server with Timeouts ──────────────────────
const server = http.createServer(app);

// Timeout tuning for VPS with limited RAM:
//   - keepAliveTimeout: close idle sockets after 65s (must be > ALB/proxy 60s)
//   - headersTimeout: reject slow clients sending headers too slowly
//   - requestTimeout: hard cap on total request processing time
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.requestTimeout = 30_000;


// ── 3. Startup Sequence ──────────────────────────────────────
async function bootstrap(): Promise<void> {
  // Catch listen-time errors (e.g. EADDRINUSE) before they reach uncaughtException
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`🔴 FATAL: Port ${PORT} is already in use. Exiting.`);
    } else {
      console.error('FATAL_HTTP_SERVER_ERROR');
    }
    process.exit(1);
  });

  // 1. Listen immediately so Easypanel/Healthcheck sees the service as UP
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Interpreters API running on http://0.0.0.0:${PORT}`);
    console.log(`   Environment: ${ENV.NODE_ENV} | PID: ${process.pid}`);
  });

  // 2. Warm up Prisma connection pool in the background
  // If it fails, the server is already listening and can return 503 via globalErrorHandler
  try {
    await warmupPrisma();
  } catch (err) {
    console.error('⚠️ PRISMA: Delayed warmup failed. Service will return 503 for DB queries.');
    // We don't exit here — let the process stay alive so logs can be inspected
  }
}

bootstrap().catch((_err) => {
  console.error('FATAL_SERVER_BOOTSTRAP');
  process.exit(1);
});


// ── 4. Graceful Shutdown ─────────────────────────────────────
// Sequence: stop accepting → drain in-flight → disconnect Prisma → exit
let isShuttingDown = false;

function gracefulShutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🔄 SHUTDOWN [${signal}]: Draining connections...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log('✅ HTTP server closed. Disconnecting Prisma...');
    await disconnectPrisma();
    console.log('✅ Clean exit.');
    process.exit(0);
  });

  // Force-kill if drain takes too long (stuck connections)
  setTimeout(() => {
    console.error(`⚠️ SHUTDOWN: Forced exit after ${SHUTDOWN_TIMEOUT_MS}ms timeout.`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref(); // .unref() so the timer doesn't prevent exit
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
