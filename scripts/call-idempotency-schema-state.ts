/**
 * Pure interpretation of database *catalog* metadata, never application rows.
 * A matching name alone is insufficient: columns, FK ownership, RLS, index
 * validity and CHECK expressions must all match the staged contract.
 */
export type CallKeySchemaState = 'absent' | 'complete' | 'partial' | 'history-drift';

export interface CatalogColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export interface CatalogConstraint {
  conname: string;
  contype: string;
  convalidated: boolean;
  key_columns: string[];
  references_schema: string | null;
  references_table: string | null;
  references_columns: string[];
  on_delete: string;
  on_update: string;
  definition: string;
}

export interface CallKeyCatalog {
  tableExists: boolean;
  rlsEnabled: boolean;
  policyCount: number;
  columns: CatalogColumn[];
  constraints: CatalogConstraint[];
  supportingIndexValid: boolean;
  migrationRecords: Array<{ migration_name: string; succeeded: boolean; rolled_back: boolean }>;
}

const EXPECTED_COLUMNS: ReadonlyArray<[string, string]> = [
  ['interpreter_id', 'integer'],
  ['request_key', 'uuid'],
  ['source', 'text'],
  ['payload_sha256', 'text'],
  ['call_session_id', 'integer'],
  ['created_at', 'timestamp with time zone'],
];

const REQUIRED_CONSTRAINTS: ReadonlyArray<{
  name: string; type: string; columns: string[];
  references?: { schema: string; table: string; columns: string[] };
}> = [
  { name: 'call_submission_keys_pkey', type: 'p', columns: ['interpreter_id', 'request_key'] },
  { name: 'call_submission_keys_call_session_unique', type: 'u', columns: ['call_session_id'] },
  { name: 'call_submission_keys_interpreter_fkey', type: 'f', columns: ['interpreter_id'],
    references: { schema: 'public', table: 'interpreters', columns: ['id'] } },
  { name: 'call_submission_keys_session_fkey', type: 'f', columns: ['call_session_id'],
    references: { schema: 'public', table: 'call_sessions', columns: ['id'] } },
  { name: 'call_submission_keys_session_ownership_fkey', type: 'f',
    columns: ['call_session_id', 'interpreter_id'],
    references: { schema: 'public', table: 'call_sessions', columns: ['id', 'interpreter_id'] } },
  { name: 'call_submission_keys_source_check', type: 'c', columns: ['source'] },
  { name: 'call_submission_keys_digest_check', type: 'c', columns: ['payload_sha256'] },
];

function sameList(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((item, i) => item === expected[i]);
}

function validConstraint(actual: CatalogConstraint, expected: (typeof REQUIRED_CONSTRAINTS)[number]): boolean {
  if (actual.conname !== expected.name || actual.contype !== expected.type ||
      actual.convalidated !== true || !sameList(actual.key_columns, expected.columns)) return false;
  if (expected.references) {
    return actual.references_schema === expected.references.schema &&
      actual.references_table === expected.references.table &&
      sameList(actual.references_columns, expected.references.columns) &&
      actual.on_delete === 'r' && actual.on_update === 'a';
  }
  if (expected.name === 'call_submission_keys_source_check') {
    return ['quick_log_action', 'quick_log_api', 'admin_manual']
      .every(source => actual.definition.includes(source)) &&
      actual.definition.includes('source');
  }
  if (expected.name === 'call_submission_keys_digest_check') {
    return actual.definition.includes('payload_sha256') &&
      actual.definition.includes('[0-9a-f]{64}');
  }
  return true;
}

export function classifyCallKeySchema(catalog: CallKeyCatalog): CallKeySchemaState {
  // An unfinished failed Prisma migration blocks subsequent migrations even
  // when its transaction rolled back and the physical table is absent. Do not
  // mislead operators with "absent" or allow --require-complete to pass.
  if (catalog.migrationRecords.some(row =>
    (!row.succeeded && !row.rolled_back) ||
    (row.succeeded && row.rolled_back))) {
    return 'history-drift';
  }
  const hasSucceededHistory = catalog.migrationRecords.some(row => row.succeeded && !row.rolled_back);
  if (!catalog.tableExists) {
    // History claiming an applied migration while the table is absent
    // indicates drift, not a valid pristine database.
    return hasSucceededHistory || catalog.supportingIndexValid ? 'history-drift' : 'absent';
  }
  if (!catalog.rlsEnabled || catalog.policyCount !== 0 ||
      !catalog.supportingIndexValid) return 'partial';

  for (const [name, type] of EXPECTED_COLUMNS) {
    const found = catalog.columns.filter(column => column.column_name === name);
    if (found.length !== 1 || found[0]?.data_type !== type || found[0]?.is_nullable !== 'NO') {
      return 'partial';
    }
  }
  // The staged DDL specifies a database-generated creation timestamp.
  // A structurally identical column without its default would make future
  // key inserts fail unless every writer explicitly supplies created_at.
  const createdAt = catalog.columns.find(column => column.column_name === 'created_at');
  if (!createdAt || !/^(?:CURRENT_TIMESTAMP|now\(\))$/i.test(createdAt.column_default?.trim() ?? '')) {
    return 'partial';
  }

  for (const expected of REQUIRED_CONSTRAINTS) {
    const actual = catalog.constraints.filter(row => row.conname === expected.name);
    if (actual.length !== 1 || !actual[0] || !validConstraint(actual[0], expected)) {
      return 'partial';
    }
  }
  return 'complete';
}
