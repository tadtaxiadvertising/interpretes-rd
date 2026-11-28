import { Prisma, type PrismaClient } from '@prisma/client';
import type { QueryResultRow } from 'pg';
import {
  classifyRoleplayReservationCatalog, readRoleplayReservationCatalog,
  type ReservationCatalogReader, type RoleplayReservationSchemaState,
} from './direct-upload-reservation-catalog';
import { readRoleplayBudgetAccounting } from './direct-upload-budget-accounting';

export type DirectCatalogDiagnostic = {
  reservation: RoleplayReservationSchemaState | 'unavailable';
  budget: 'absent' | 'incomplete' | 'accounting-consistent' | 'review-required' | 'unavailable';
  capacity: { maxSlots: number; allocatedSlots: number; remainingSlots: number } | null;
};

const unavailable: DirectCatalogDiagnostic = { reservation: 'unavailable', budget: 'unavailable', capacity: null };

/** On-demand, read-only snapshot of the application's actual connection.
 * Recognizable catalog markers and aggregate accounting are NOT proof of
 * effective runtime write privileges, Storage safety or activation readiness. */
export async function inspectDirectUploadCatalog(db: Pick<PrismaClient, '$transaction'>): Promise<DirectCatalogDiagnostic> {
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const reader: ReservationCatalogReader = {
        async query<T extends QueryResultRow>(sql: string) {
          const rows = await tx.$queryRaw<T[]>(Prisma.raw(sql));
          return { rows, rowCount: rows.length };
        },
      };
      const reservation = classifyRoleplayReservationCatalog(await readRoleplayReservationCatalog(reader));
      const { budget } = await readRoleplayBudgetAccounting(reader);
      const state = budget.state;
      if (state !== 'absent' && state !== 'incomplete' && state !== 'accounting-consistent' && state !== 'review-required') return unavailable;
      // Never display usable capacity for inconsistent or untracked accounting.
      const capacity = state === 'accounting-consistent' && reservation === 'catalog-ready' &&
        'maxSlots' in budget && typeof budget.maxSlots === 'number' &&
        typeof budget.allocatedSlots === 'number' && typeof budget.remainingSlots === 'number' &&
        budget.orphanCharges === 0 && budget.untrackedCharges === 0
        ? { maxSlots: budget.maxSlots, allocatedSlots: budget.allocatedSlots, remainingSlots: budget.remainingSlots } : null;
      return { reservation, budget: state, capacity };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 });
  } catch {
    // Database errors may include personal data, credentials or endpoints.
    return unavailable;
  }
}
