import type { Client } from 'pg';

export type CreationLedgerState = 'absent' | 'incomplete' | 'historical' | 'hardened-catalog';

export interface CreationLedgerCatalog {
  relationKind: string | null;
  rls: boolean;
  policies: number;
  unsafeGrants: number;
  columns: Array<{ name: string; type: string; nullable: boolean; defaultValue: string | null }>;
  constraints: Array<{ name: string; kind: string; validated: boolean; deferrable: boolean; columns: string[]; definition: string }>;
}

const expectedColumns: Array<[string, string, boolean]> = [
  ['id', 'text', false], ['actor_user_id', 'text', false], ['request_key', 'uuid', false],
  ['payload_hash', 'character varying(64)', false], ['status', 'character varying(20)', false],
  ['session_ids', 'text[]', false], ['created_count', 'integer', true],
  ['skipped_count', 'integer', true], ['scenario_count', 'integer', true],
  ['created_at', 'timestamp(6) with time zone', false], ['completed_at', 'timestamp(6) with time zone', true],
];

/**
 * Catalog classification is deliberately not activation approval. It checks
 * structure and recognizable CHECK markers, not semantic equivalence of SQL.
 * The isolated PostgreSQL verifier separately exercises actual writes.
 */
export function classifyCreationLedgerCatalog(c: CreationLedgerCatalog): CreationLedgerState {
  if (c.relationKind === null) return 'absent';
  if (c.relationKind !== 'r' || !c.rls || c.policies !== 0 || c.unsafeGrants !== 0 ||
      c.columns.length !== expectedColumns.length) return 'incomplete';
  for (const [name, type, nullable] of expectedColumns) {
    const column = c.columns.find(row => row.name === name);
    if (!column || column.type !== type || column.nullable !== nullable) return 'incomplete';
    const value = column.defaultValue ?? '';
    if (name === 'status' ? !/^'IN_PROGRESS'(?:::(?:character varying|text))?$/.test(value)
      : name === 'session_ids' ? !/^(?:ARRAY\[\]::text\[\]|'\{\}'::text\[\])$/i.test(value.replace(/\s/g, ''))
      : name === 'created_at' ? !/^(?:CURRENT_TIMESTAMP|now\(\))$/i.test(value)
      : column.defaultValue !== null) return 'incomplete';
  }
  const prefix = 'roleplay_creation_requests_';
  const required = [
    ['pkey', 'p', ['id']], ['actor_key', 'u', ['actor_user_id', 'request_key']],
    ['actor_nonempty', 'c', []], ['payload_hex', 'c', []], ['status_check', 'c', []],
    ['result_check', 'c', []],
  ] as const;
  for (const [name, kind, columns] of required) {
    const row = c.constraints.find(item => item.name === prefix + name);
    if (!row || row.kind !== kind || !row.validated || row.deferrable ||
        (kind !== 'c' && row.columns.join(',') !== columns.join(','))) return 'incomplete';
  }
  const check = c.constraints.find(row => row.name === prefix + 'result_check')!.definition.toLowerCase();
  const actorLength = c.constraints.find(row => row.name === prefix + 'actor_length_check');
  if (!actorLength && c.constraints.length === required.length &&
      /\b100000\b/.test(check) && !check.includes('created_count is not null')) return 'historical';
  if (!actorLength || c.constraints.length !== required.length + 1 ||
      actorLength.kind !== 'c' || !actorLength.validated || actorLength.deferrable ||
      !/length\(actor_user_id\)\s*<=\s*256\b/i.test(actorLength.definition) ||
      !/\b1000\b/.test(check) || /\b100000\b/.test(check) ||
      !['created_count is not null', 'skipped_count is not null', 'scenario_count is not null',
        'array_position(session_ids', 'cardinality(session_ids)'].every(token => check.includes(token)) ||
      /\bor\s+\(?\s*(?:true|1\s*=\s*1)\b/i.test(check)) return 'incomplete';
  return 'hardened-catalog';
}

/** Catalog SELECTs only; caller must own a read-only transaction. */
export async function readCreationLedgerCatalog(db: Pick<Client, 'query'>): Promise<CreationLedgerCatalog> {
  const table = await db.query<{ kind: string; rls: boolean }>(
    "SELECT relkind AS kind, relrowsecurity AS rls FROM pg_class WHERE oid=to_regclass('public.roleplay_creation_requests')",
  );
  if (!table.rows[0]) return { relationKind: null, rls: false, policies: 0, unsafeGrants: 0, columns: [], constraints: [] };
  const [columns, constraints, policies, grants] = await Promise.all([
    db.query<CreationLedgerCatalog['columns'][number]>([
      'SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,',
      'NOT a.attnotnull AS nullable, pg_get_expr(d.adbin,d.adrelid) AS "defaultValue"',
      'FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum',
      "WHERE a.attrelid=to_regclass('public.roleplay_creation_requests') AND a.attnum>0 AND NOT a.attisdropped",
    ].join(' ')),
    db.query<CreationLedgerCatalog['constraints'][number]>([
      'SELECT c.conname AS name, c.contype AS kind, c.convalidated AS validated, c.condeferrable AS deferrable,',
      'to_json(ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum,ord)',
      'JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)) AS columns,',
      'pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c',
      "WHERE c.conrelid=to_regclass('public.roleplay_creation_requests')",
    ].join(' ')),
    db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='roleplay_creation_requests'"),
    db.query<{ n: number }>([
      'SELECT count(*)::int AS n FROM (',
      'SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl,acldefault(\'r\',c.relowner))) acl',
      "WHERE c.oid=to_regclass('public.roleplay_creation_requests') AND acl.grantee=0",
      'UNION ALL SELECT 1 FROM pg_roles r',
      "WHERE r.rolname IN ('anon','authenticated') AND (",
      "has_table_privilege(r.oid,to_regclass('public.roleplay_creation_requests'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
      "OR has_any_column_privilege(r.oid,to_regclass('public.roleplay_creation_requests'),'SELECT,INSERT,UPDATE,REFERENCES'))",
      'UNION ALL SELECT 1 FROM pg_attribute a, LATERAL aclexplode(a.attacl) acl',
      "WHERE a.attrelid=to_regclass('public.roleplay_creation_requests') AND acl.grantee=0",
      ') unsafe',
    ].join(' ')),
  ]);
  return {
    relationKind: table.rows[0].kind, rls: table.rows[0].rls,
    policies: policies.rows[0]?.n ?? -1, unsafeGrants: grants.rows[0]?.n ?? -1,
    columns: columns.rows, constraints: constraints.rows,
  };
}
