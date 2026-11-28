import type { ReservationCatalogReader } from './direct-upload-reservation-catalog';

export const DIRECT_LEDGER_TABLES = [
  'roleplay_upload_reservations',
  'roleplay_direct_upload_budget',
  'roleplay_direct_upload_budget_charges',
  'roleplay_final_write_claims',
  'roleplay_final_upload_evidence',
] as const;

type LedgerTable = typeof DIRECT_LEDGER_TABLES[number];
export type DirectLedgerPermissionState = 'recognized' | 'review-required' | 'unavailable';
export type DirectLedgerPermissions = {
  state: DirectLedgerPermissionState;
  tables: { name: LedgerTable; runtimeAccess: boolean; privateAccess: boolean }[];
};

export const unavailableDirectLedgerPermissions: DirectLedgerPermissions = { state: 'unavailable', tables: [] };

/** Checks effective grants of the current connection and expected isolation
 * of the five internal tables. No role names, identities, ACLs or row data
 * leave the query. Not a live write test or a complete publication audit. */
export const DIRECT_LEDGER_PERMISSIONS_SQL = `
WITH required(name, needs_insert, needs_update) AS (
  VALUES
    ('roleplay_upload_reservations', true, true),
    ('roleplay_direct_upload_budget', false, true),
    ('roleplay_direct_upload_budget_charges', true, true),
    ('roleplay_final_write_claims', true, false),
    ('roleplay_final_upload_evidence', true, false)
)
SELECT r.name,
  CASE WHEN c.relkind='r' THEN
    has_schema_privilege(current_user, 'public', 'USAGE')
    AND has_table_privilege(current_user, c.oid, 'SELECT')
    AND (NOT r.needs_insert OR has_table_privilege(current_user, c.oid, 'INSERT'))
    AND (NOT r.needs_update OR has_table_privilege(current_user, c.oid, 'UPDATE'))
    AND NOT row_security_active(c.oid)
    ELSE false END AS runtime_access,
  CASE WHEN c.relkind='r' THEN
    c.relrowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid)
    AND NOT EXISTS (
      SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee=0
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_attribute col, LATERAL aclexplode(col.attacl) a
      WHERE col.attrelid=c.oid AND col.attnum>0 AND NOT col.attisdropped AND a.grantee=0
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_roles p WHERE p.rolname IN ('anon','authenticated') AND (
        has_table_privilege(p.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(p.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
      )
    )
    ELSE false END AS private_access
FROM required r
LEFT JOIN pg_class c ON c.oid=to_regclass('public.' || r.name)
`;

export async function readDirectLedgerPermissions(db: ReservationCatalogReader): Promise<DirectLedgerPermissions> {
  const { rows } = await db.query<{ name: string; runtime_access: boolean; private_access: boolean }>(DIRECT_LEDGER_PERMISSIONS_SQL);
  if (rows.length !== DIRECT_LEDGER_TABLES.length) return unavailableDirectLedgerPermissions;
  const tables: DirectLedgerPermissions['tables'] = [];
  for (const name of DIRECT_LEDGER_TABLES) {
    const matches = rows.filter(row => row.name === name);
    if (matches.length !== 1 || typeof matches[0].runtime_access !== 'boolean' ||
        typeof matches[0].private_access !== 'boolean') return unavailableDirectLedgerPermissions;
    tables.push({ name, runtimeAccess: matches[0].runtime_access, privateAccess: matches[0].private_access });
  }
  return { state: tables.every(table => table.runtimeAccess && table.privateAccess) ? 'recognized' : 'review-required', tables };
}
