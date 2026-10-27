import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * PRISMA 7 SINGLETON — SUPABASE TRANSACTION POOLER (Port 6543)
 * ============================================================
 * Optimized for ~457 MB RAM containers on Easypanel.
 *
 * CRITICAL DESIGN DECISIONS:
 *   1. LAZY initialization: Pool + PrismaClient are created ONLY on
 *      first access via `getPrisma()`. This prevents the health check
 *      from timing out while waiting for the pool to warm up during
 *      the container's cold-start window.
 *   2. STRICT pool limits: max=5 connections via pgBouncer port 6543.
 *      `?pgbouncer=true&connection_limit=5` MUST be in DATABASE_URL.
 *   3. Global singleton: Attached to `globalThis` to survive HMR in
 *      development and avoid pool exhaustion from module reloads.
 *   4. NEVER calls `pool.end()` — the pool lives for the entire
 *      process lifetime. Premature cleanup causes the fatal
 *      "Cannot use a pool after calling end" crash.
 *
 * CONNECTION STRING FORMAT (Easypanel env):
 *   postgresql://user:pass@host:6543/db?pgbouncer=true&connection_limit=5
 * ============================================================
 */

const globalForPrisma = globalThis as unknown as {
  __prisma_singleton: PrismaClient | undefined;
  __pg_pool: pg.Pool | undefined;
};

function createPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error(
      '[PRISMA] FATAL: DATABASE_URL is not set. ' +
      'The application will crash on the first database query.'
    );
  }

  // The pg adapter receives an explicit SSL object, which overrides `sslmode=disable`
  // from the connection string. Keep TLS enabled for remote databases, but disable
  // it for loopback-only databases such as the disposable PostgreSQL used by E2E.
  const isLoopbackDatabase = (() => {
    if (!connectionString) return false;
    try {
      const hostname = new URL(connectionString).hostname;
      return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
    } catch {
      return false;
    }
  })();

  return new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLoopbackDatabase ? false : { rejectUnauthorized: false },
    allowExitOnIdle: true,
  });
}

function createPrismaClient(): PrismaClient {
  if (!globalForPrisma.__pg_pool) {
    globalForPrisma.__pg_pool = createPool();
  }

  const adapter = new PrismaPg(globalForPrisma.__pg_pool);

  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  });

  return client;
}

/**
 * Returns the global PrismaClient singleton.
 * Safe to call from Server Components, Server Actions, API Routes,
 * and the health check endpoint.
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__prisma_singleton) {
    globalForPrisma.__prisma_singleton = createPrismaClient();
  }
  return globalForPrisma.__prisma_singleton;
}

/**
 * Exposes the raw pg.Pool for ultra-lightweight queries
 * (e.g., health check `SELECT 1`). Creates the pool lazily
 * if it hasn't been created yet.
 */
export function getRawPool(): pg.Pool {
  if (!globalForPrisma.__pg_pool) {
    globalForPrisma.__pg_pool = createPool();
  }
  return globalForPrisma.__pg_pool;
}

/**
 * Default export for backward compatibility with existing imports:
 *   import prisma from '@/lib/prisma';
 *
 * Uses a Proxy so the actual PrismaClient creation is deferred
 * until the first property access (true lazy initialization).
 */
const prismaProxy = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    const client = getPrisma();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});

export const prisma = prismaProxy;
export default prismaProxy;
