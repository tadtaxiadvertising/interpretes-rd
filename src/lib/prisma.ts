import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDatabasePoolConfig } from '@/lib/database-pool-config';

/**
 * PRISMA 7 SINGLETON — SUPABASE TRANSACTION POOLER (Port 6543)
 * Optimized for the Easypanel runtime. The Supabase root CA is bundled as a
 * public certificate file in the image; no certificate environment variable
 * or Base64 transport is required.
 */

const globalForPrisma = globalThis as unknown as {
  __prisma_singleton: PrismaClient | undefined;
  __pg_pool: pg.Pool | undefined;
};

function createPool(): pg.Pool {
  const caPem = readFileSync(
    join(process.cwd(), 'certs', 'prod-ca-2021.crt'),
    'utf8',
  );

  return new pg.Pool(createDatabasePoolConfig(
    process.env.DATABASE_URL,
    caPem,
  ));
}

function createPrismaClient(): PrismaClient {
  if (!globalForPrisma.__pg_pool) {
    globalForPrisma.__pg_pool = createPool();
  }

  const adapter = new PrismaPg(globalForPrisma.__pg_pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  });
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__prisma_singleton) {
    globalForPrisma.__prisma_singleton = createPrismaClient();
  }
  return globalForPrisma.__prisma_singleton;
}

export function getRawPool(): pg.Pool {
  if (!globalForPrisma.__pg_pool) {
    globalForPrisma.__pg_pool = createPool();
  }
  return globalForPrisma.__pg_pool;
}

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
