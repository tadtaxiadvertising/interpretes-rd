import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVerifiedDatabasePoolConfig } from './database-tls.js';

/**
 * PRISMA CLIENT SINGLETON (interpreters-api)
 * ============================================================
 * Optimizado para Easypanel VPS con Supabase Free Tier.
 *
 * REGLAS ESTRICTAS:
 *   1. SIEMPRE Singleton — cacheado en globalThis en TODOS los entornos.
 *   2. Connection pool limitado a 3 (Supabase Free: ~20 max, compartidas
 *      entre 4 servicios → 5 por servicio → 3 activas + 2 headroom).
 *   3. Logging mínimo en producción para no saturar stdout/Easypanel logs.
 *   4. Shutdown graceful obligatorio para evitar conexiones huérfanas.
 *   5. Warmup con $connect() para detectar errores de conexión al boot.
 *
 * IMPORTANTE: Las queries NUNCA deben usar `include` genéricos.
 *   Siempre usa `select` explícito para minimizar CPU y memoria.
 *   Ejemplo correcto:
 *     prisma.user.findMany({ select: { id: true, email: true, role: true } })
 *   Ejemplo PROHIBIDO:
 *     prisma.user.findMany({ include: { interpreter: true } })
 * ============================================================
 */

const globalForPrisma = globalThis as unknown as {
  _prismaApi: PrismaClient | undefined;
  _prismaApiShutdownRegistered: boolean | undefined;
  _isShuttingDown: boolean | undefined;
};

function createPrismaClient(): PrismaClient {
  const pool = new pg.Pool(createVerifiedDatabasePoolConfig(
    process.env.DATABASE_URL,
    () => readFileSync(resolve(process.cwd(), 'certs/prod-ca-2021.crt'), 'utf8'),
  ));
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'production'
      ? ['error']
      : ['query', 'info', 'warn', 'error'],
  });
}

const prisma: PrismaClient = globalForPrisma._prismaApi ?? createPrismaClient();

// Cache in ALL environments — prevents connection pool exhaustion
// from hot-reloads (dev) and serverless cold starts (production).
globalForPrisma._prismaApi = prisma;

export { prisma };


// ── Warmup: Eagerly open the connection pool at import time ──
// This surfaces DATABASE_URL / auth errors immediately at boot
// rather than on the first user request.
export async function warmupPrisma(): Promise<void> {
  try {
    // Enforce connection limit check
    const url = process.env.DATABASE_URL || '';
    if (!url.includes('connection_limit=')) {
      console.warn('⚠️ PRISMA: DATABASE_URL is missing "connection_limit". Defaulting to internal pool limits may exceed Supabase Free Tier.');
    }

    await prisma.$connect();
    console.log('✅ PRISMA: Connection pool warmed up (interpreters-api).');
  } catch (err) {
    console.error(
      '🔴 PRISMA: Failed to connect at startup:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    // Do NOT process.exit here — let the health check surface the failure.
    // The server.ts startup handler will decide whether to abort.
    throw err;
  }
}


// ── Disconnect: For use during graceful shutdown ─────────────
export async function disconnectPrisma(): Promise<void> {
  if (globalForPrisma._isShuttingDown) return;
  globalForPrisma._isShuttingDown = true;

  console.log('🔄 PRISMA: Disconnecting (interpreters-api)...');
  try {
    await prisma.$disconnect();
    console.log('✅ PRISMA: Connection closed cleanly (interpreters-api).');
  } catch (err) {
    console.error(
      '⚠️ PRISMA: Error during disconnect:',
      err instanceof Error ? err.name : 'UnknownError'
    );
  }
}


// Signal handlers removed to avoid conflicts with server.ts
// Centralized shutdown is handled in the server entrypoint.
