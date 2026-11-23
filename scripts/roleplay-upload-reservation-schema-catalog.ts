import type { Client } from 'pg';

export interface RoleplayReservationCatalog {
  tableExists: boolean;
  rlsEnabled: boolean;
  policyCount: number;
  publicGrantCount: number;
  columns: Array<{
    name: string; type: string; nullable: boolean;
    maxLength: number | null; defaultValue: string | null;
  }>;
  constraints: Array<{
    name: string; kind: string; validated: boolean;
    columns: string[]; definition: string;
  }>;
}

export type RoleplayReservationSchemaState = 'absent' | 'incomplete' | 'catalog-ready';

const columns: Array<[string, string, number | null]> = [
  ['id', 'uuid', null],
  ['actor_user_id', 'text', null],
  ['request_key', 'uuid', null],
  ['declaration_hash', 'character varying', 64],
  ['status', 'character varying', 20],
  ['items', 'jsonb', null],
  ['verified_objects', 'jsonb', null],
  ['published_session_ids', 'ARRAY', null],
  ['created_at', 'timestamp with time zone', null],
  ['expires_at', 'timestamp with time zone', null],
];

const constraints: Array<[string, string, string[]]> = [
  ['roleplay_upload_reservations_pkey', 'p', ['id']],
  ['roleplay_upload_reservations_actor_key', 'u', ['actor_user_id', 'request_key']],
  ['roleplay_upload_reservations_owner_check', 'c', []],
  ['roleplay_upload_reservations_digest_check', 'c', []],
  ['roleplay_upload_reservations_status_check', 'c', []],
  ['roleplay_upload_reservations_expiry_check', 'c', []],
  ['roleplay_upload_reservations_items_check', 'c', []],
  ['roleplay_upload_reservations_evidence_check', 'c', []],
  ['roleplay_upload_reservations_publication_receipt_check', 'c', []],
];

function same(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    actual.every((v, i) => v === expected[i]);
}

/**
 * Catalog-only readiness is deliberately NOT proof that a CHECK expression
 * is secure. The isolated PostgreSQL verifier tests real invalid writes.
 * A DBA must review definitions before approving the staged migration.
 */
export function classifyRoleplayReservationCatalog(
  catalog: RoleplayReservationCatalog,
): RoleplayReservationSchemaState {
  if (!catalog.tableExists) {
    return catalog.columns.length || catalog.constraints.length ||
      catalog.policyCount || catalog.publicGrantCount ? 'incomplete' : 'absent';
  }
  if (!catalog.rlsEnabled || catalog.policyCount !== 0 ||
      catalog.publicGrantCount !== 0 ||
      catalog.columns.length !== columns.length ||
      catalog.constraints.length !== constraints.length) {
    return 'incomplete';
  }
  for (const [name, type, maxLength] of columns) {
    const present = catalog.columns.filter(c => c.name === name);
    if (present.length !== 1 || present[0]?.type !== type ||
        present[0]?.nullable || present[0]?.maxLength !== maxLength) {
      return 'incomplete';
    }
  }
  const defaults = new Map(catalog.columns.map(c => [c.name, c.defaultValue]));
  if (defaults.get('id') !== null ||
      defaults.get('request_key') !== null ||
      defaults.get('actor_user_id') !== null ||
      defaults.get('declaration_hash') !== null ||
      defaults.get('items') !== null ||
      defaults.get('expires_at') !== null ||
      !/^(?:'RESERVED'(?:::(?:character varying|text))?)$/.test(defaults.get('status')?.trim() ?? '') ||
      !/^\[\]$/.test((defaults.get('verified_objects') ?? '').replace(/^'|'::jsonb$/g, '')) ||
      !/^(?:ARRAY\[\]::text\[\]|'\{\}'::text\[\])$/i.test(
        (defaults.get('published_session_ids') ?? '').replace(/\s/g, ''),
      ) ||
      !/^(?:CURRENT_TIMESTAMP|now\(\))$/i.test(defaults.get('created_at')?.trim() ?? '')) {
    return 'incomplete';
  }
  for (const [name, kind, key] of constraints) {
    const found = catalog.constraints.filter(c => c.name === name);
    if (found.length !== 1 || !found[0] ||
        found[0].kind !== kind || !found[0].validated ||
        (kind !== 'c' && !same(found[0].columns, key)) ||
        // This only blocks obvious accidental tautologies; it is not a
        // security-equivalence parser for arbitrary CHECK definitions.
        (kind === 'c' && (!found[0].definition.startsWith('CHECK (') ||
          /\bOR\s+(?:TRUE|1\s*=\s*1)\b/i.test(found[0].definition)))) {
      return 'incomplete';
    }
  }
  return 'catalog-ready';
}

/** SELECT-only; caller owns BEGIN READ ONLY/ROLLBACK and TLS authentication. */
export async function readRoleplayReservationCatalog(
  db: Pick<Client, 'query'>,
): Promise<RoleplayReservationCatalog> {
  const table = await db.query<{ rls: boolean }>(
    "SELECT relrowsecurity AS rls FROM pg_class WHERE oid = to_regclass('public.roleplay_upload_reservations')",
  );
  const tableExists = table.rowCount === 1;
  const absent = {
    tableExists: false, rlsEnabled: false, policyCount: 0,
    publicGrantCount: 0, columns: [], constraints: [],
  };
  if (!tableExists) return absent;

  const [columnRows, constraintRows, policyRows, grantsRows] = await Promise.all([
    db.query<{
      name: string; type: string; nullable: boolean;
      maxLength: number | null; defaultValue: string | null;
    }>([
      'SELECT column_name AS name, data_type AS type,',
      "(is_nullable = 'YES') AS nullable, character_maximum_length AS \"maxLength\",",
      'column_default AS "defaultValue" FROM information_schema.columns',
      "WHERE table_schema='public' AND table_name='roleplay_upload_reservations'",
    ].join(' ')),
    db.query<{ name: string; kind: string; validated: boolean; columns: string[]; definition: string }>([
      'SELECT c.conname AS name, c.contype AS kind, c.convalidated AS validated,',
      'to_json(ARRAY(SELECT a.attname FROM unnest(c.conkey)',
      'WITH ORDINALITY AS k(attnum, ord)',
      'JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum',
      'ORDER BY k.ord)) AS columns,',
      'pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c',
      "WHERE c.conrelid=to_regclass('public.roleplay_upload_reservations')",
    ].join(' ')),
    db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_policies WHERE schemaname='public' AND tablename='roleplay_upload_reservations'",
    ),
    db.query<{ count: number }>([
      'SELECT count(*)::int AS count FROM information_schema.role_table_grants',
      "WHERE table_schema='public' AND table_name='roleplay_upload_reservations'",
      "AND grantee IN ('PUBLIC','anon','authenticated')",
    ].join(' ')),
  ]);
  return {
    tableExists,
    rlsEnabled: table.rows[0]?.rls === true,
    policyCount: policyRows.rows[0]?.count ?? -1,
    publicGrantCount: grantsRows.rows[0]?.count ?? -1,
    columns: columnRows.rows,
    constraints: constraintRows.rows,
  };
}
