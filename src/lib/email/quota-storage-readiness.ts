import type { Prisma } from '@prisma/client';

type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
export type QuotaStorageReadiness = 'ready' | 'not_installed' | 'permission_mismatch' | 'unavailable';

/** Metadata only. No reservations, secret access or provider requests. */
export async function inspectQuotaStorage(db: Reader): Promise<QuotaStorageReadiness> {
  try {
    const [row] = await db.$queryRaw<{ installed: boolean; privateAccess: boolean; runtimeAccess: boolean; rls: boolean }[]>`
      WITH objects AS (
        SELECT to_regnamespace('private_email') AS ns, to_regclass('private_email.provider_quota') AS q
      )
      SELECT q IS NOT NULL AND (
        SELECT count(*) = 7 FROM pg_attribute
        WHERE attrelid=q AND NOT attisdropped AND attname IN
          ('provider','daily_limit','monthly_limit','daily_used','monthly_used','day_start','month_start')
      ) AS installed,
      NOT EXISTS (
        SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
          AND (has_schema_privilege(r.oid,ns,'USAGE,CREATE')
            OR has_table_privilege(r.oid,q,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
      ) AS "privateAccess",
      COALESCE(has_schema_privilege(current_user,ns,'USAGE')
        AND has_table_privilege(current_user,q,'SELECT')
        AND has_table_privilege(current_user,q,'UPDATE')
        AND NOT row_security_active(q),false) AS "runtimeAccess",
      COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid=q),false) AS rls
      FROM objects
    `;
    if (!row) return 'unavailable';
    if (!row.installed) return 'not_installed';
    if (!row.privateAccess || !row.runtimeAccess || !row.rls) return 'permission_mismatch';
    return 'ready';
  } catch { return 'unavailable'; }
}
