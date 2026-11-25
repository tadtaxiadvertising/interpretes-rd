import type { Prisma } from '@prisma/client';
import { vaultKeyAvailable } from './provider-vault';
import { providerSelectionPaused } from './provider-selection';

type Env = Readonly<Record<string, string | undefined>>;
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
export type VaultReadiness = {
  database: 'ready' | 'not_installed' | 'permission_mismatch' | 'unavailable';
  enabled: boolean;
  encryption: 'missing' | 'invalid' | 'valid_format';
  source: 'environment' | 'vault' | 'invalid';
  paused: boolean;
};
type Row = { installed: boolean; columnsReady: boolean; privateAccess: boolean; runtimeAccess: boolean; rls: boolean };

/** Metadata-only diagnostics. Never read stored keys, profiles or external APIs.
 * Current deployment uses an owner connection; active RLS for a custom runtime
 * role is conservatively reported for review, not assumed to be writable. */
export async function inspectProviderVault(db: Reader, env: Env): Promise<VaultReadiness> {
  const result: VaultReadiness = {
    database: 'unavailable',
    enabled: env.EMAIL_PROVIDER_VAULT_ENABLED === 'true',
    encryption: !env.EMAIL_PROVIDER_ENCRYPTION_KEY ? 'missing' : vaultKeyAvailable(env.EMAIL_PROVIDER_ENCRYPTION_KEY) ? 'valid_format' : 'invalid',
    source: env.EMAIL_PROVIDER_SOURCE === 'vault' ? 'vault' : !env.EMAIL_PROVIDER_SOURCE || env.EMAIL_PROVIDER_SOURCE === 'environment' ? 'environment' : 'invalid',
    paused: providerSelectionPaused(env),
  };
  try {
    const [row] = await db.$queryRaw<Row[]>`
      WITH objects AS (
        SELECT to_regnamespace('private_email') AS ns,
          to_regclass('private_email.provider_profile') AS p,
          to_regclass('private_email.provider_quota') AS q,
          to_regclass('private_email.provider_selection') AS s,
          to_regclass('private_email.provider_budget_audit') AS a,
          to_regclass('private_email.provider_budget_audit_id_seq') AS seq
      )
      SELECT (p IS NOT NULL AND q IS NOT NULL AND s IS NOT NULL AND a IS NOT NULL AND seq IS NOT NULL) AS installed,
        (SELECT count(*) = 6 FROM pg_attribute WHERE attrelid=p AND NOT attisdropped
          AND attname IN ('test_accepted_at','receipt_confirmed_at','receipt_confirmed_by','retired_at','retired_by','replaces_id')) AS "columnsReady",
        NOT EXISTS (
          SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
            AND (has_schema_privilege(r.oid,ns,'USAGE,CREATE')
              OR has_table_privilege(r.oid,p,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              OR has_table_privilege(r.oid,q,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              OR has_table_privilege(r.oid,s,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              OR has_table_privilege(r.oid,a,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              OR has_sequence_privilege(r.oid,seq,'USAGE,SELECT,UPDATE'))
        ) AS "privateAccess",
        COALESCE(has_schema_privilege(current_user,ns,'USAGE')
          AND has_table_privilege(current_user,p,'SELECT')
          AND has_table_privilege(current_user,p,'INSERT')
          AND has_table_privilege(current_user,p,'UPDATE')
          AND has_table_privilege(current_user,q,'SELECT')
          AND has_table_privilege(current_user,q,'UPDATE')
          AND has_table_privilege(current_user,s,'SELECT')
          AND has_table_privilege(current_user,s,'UPDATE')
          AND has_table_privilege(current_user,a,'INSERT')
          AND has_column_privilege(current_user,a,'provider','SELECT')
          AND has_sequence_privilege(current_user,seq,'USAGE')
          AND NOT row_security_active(p) AND NOT row_security_active(q)
          AND NOT row_security_active(s) AND NOT row_security_active(a),false) AS "runtimeAccess",
        COALESCE((SELECT count(*)=4 AND bool_and(relrowsecurity)
          FROM pg_class WHERE oid IN (p,q,s,a)),false) AS rls
      FROM objects
    `;
    if (!row) return result;
    result.database = !row.installed || !row.columnsReady ? 'not_installed'
      : !row.privateAccess || !row.runtimeAccess || !row.rls ? 'permission_mismatch' : 'ready';
    return result;
  } catch { return result; }
}
