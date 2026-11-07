import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { createDatabasePoolConfig } from '@/lib/database-pool-config';

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
 *   Remote connections require authenticated TLS. Configure either
 *   DATABASE_TLS_CA_PEM or DATABASE_TLS_CA_PEM_BASE64.
 * ============================================================
 */

const globalForPrisma = globalThis as unknown as {
  __prisma_singleton: PrismaClient | undefined;
  __pg_pool: pg.Pool | undefined;
};

function createPool(): pg.Pool {
  return new pg.Pool(createDatabasePoolConfig(
    process.env.DATABASE_URL,
    process.env.DATABASE_TLS_CA_PEM,
    process.env.DATABASE_TLS_CA_PEM_BASE64,
  ));
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
