import { Prisma, type PrismaClient } from '@prisma/client';
import type { QueryResultRow } from 'pg';
import {
  classifyCreationLedgerCatalog, readCreationLedgerCatalog, hasCreationLedgerRuntimeAccess,
  type CreationLedgerCatalogReader,
} from './creation-ledger-catalog';

/**
 * Fresh read from the runtime connection. No client values enter catalog SQL.
 * A recognizable hardened catalog is necessary, not sufficient for rollout.
 * Never cache a positive result across requests or fall back on DB failure.
 */
export async function isCreationLedgerReady(db: Pick<PrismaClient, '$transaction'>): Promise<boolean> {
  try {
    return await db.$transaction(async tx => {
      const reader: CreationLedgerCatalogReader = {
        async query<T extends QueryResultRow>(sql: string) {
          // Only fixed catalog SELECT strings from our shared module.
          return { rows: await tx.$queryRaw<T[]>(Prisma.raw(sql)) };
        },
      };
      if (classifyCreationLedgerCatalog(await readCreationLedgerCatalog(reader)) !== 'hardened-catalog') return false;
      return await hasCreationLedgerRuntimeAccess(reader);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 });
  } catch {
    // No raw driver details in logs or responses.
    return false;
  }
}
