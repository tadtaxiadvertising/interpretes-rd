import type { Prisma } from '@prisma/client';

export type EmailDatabaseReadiness = { status: 'not_installed' | 'permission_mismatch' | 'ready' | 'unavailable' };
type Row = { delivery: boolean; binding: boolean; runtimeAccess: boolean; privateAccess: boolean; rls: boolean };

/** Metadata only, using the actual Next.js database connection. No rows or secrets. */
export async function readEmailDatabaseReadiness(db: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<EmailDatabaseReadiness> {
  try {
    const [row] = await db.$queryRaw<Row[]>`
      WITH objects AS (
        SELECT to_regnamespace('private_email') AS ns,
          to_regclass('private_email.recruitment_delivery') AS d,
          to_regclass('private_email.candidate_account_binding') AS b
      )
      SELECT d IS NOT NULL AS delivery, b IS NOT NULL AS binding,
        COALESCE(has_schema_privilege(current_user, ns, 'USAGE')
          AND has_table_privilege(current_user, d, 'SELECT')
          AND has_table_privilege(current_user, d, 'INSERT')
          AND has_table_privilege(current_user, d, 'UPDATE')
          AND has_table_privilege(current_user, b, 'SELECT')
          AND has_table_privilege(current_user, b, 'INSERT'), false) AS "runtimeAccess",
        NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
          AND (has_schema_privilege(r.oid, ns, 'USAGE') OR has_table_privilege(r.oid, d, 'SELECT,INSERT,UPDATE,DELETE')
            OR has_table_privilege(r.oid, b, 'SELECT,INSERT,UPDATE,DELETE'))) AS "privateAccess",
        COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = d), false)
          AND COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = b), false) AS rls
      FROM objects
    `;
    if (!row) return { status: 'unavailable' };
    if (!row.delivery || !row.binding) return { status: 'not_installed' };
    if (!row.runtimeAccess || !row.privateAccess || !row.rls) return { status: 'permission_mismatch' };
    return { status: 'ready' };
  } catch {
    return { status: 'unavailable' };
  }
}
