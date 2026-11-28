import { Prisma, type PrismaClient } from '@prisma/client';
import type { QueryResultRow } from 'pg';
import { readRoleplayDirectRolloutReadiness } from './direct-upload-rollout-metadata';
import type { ReservationCatalogReader } from './direct-upload-reservation-catalog';

type Report = Awaited<ReturnType<typeof readRoleplayDirectRolloutReadiness>>;
export type DirectRolloutMetadata = Pick<Report, 'schemaMetadataReady' | 'tableChecks' | 'triggerChecks' | 'columnChecks' | 'buckets'>;

/** Independent, explicit metadata probe. No Storage API calls or live writes.
 * Failure must not discard the separately obtained reservation/budget result. */
export async function inspectDirectRolloutMetadata(db: Pick<PrismaClient, '$transaction'>): Promise<DirectRolloutMetadata | null> {
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const reader: ReservationCatalogReader = {
        async query<T extends QueryResultRow>(sql: string) {
          const rows = await tx.$queryRaw<T[]>(Prisma.raw(sql));
          return { rows, rowCount: rows.length };
        },
      };
      const { schemaMetadataReady, tableChecks, triggerChecks, columnChecks, buckets } =
        await readRoleplayDirectRolloutReadiness(reader, {});
      return { schemaMetadataReady, tableChecks, triggerChecks, columnChecks, buckets };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 });
  } catch {
    // Never expose connection details, provider errors or SQL results.
    return null;
  }
}
