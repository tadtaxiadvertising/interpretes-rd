import { describe, expect, it } from 'vitest';
import {
  classifyCallKeySchema,
  type CallKeyCatalog,
  type CatalogConstraint,
} from './call-idempotency-schema-state';

const cols = [
  ['interpreter_id', 'integer'],
  ['request_key', 'uuid'],
  ['source', 'text'],
  ['payload_sha256', 'text'],
  ['call_session_id', 'integer'],
  ['created_at', 'timestamp with time zone'],
] as const;

const fk = (
  conname: string,
  columns: string[],
  references_table: string,
  references_columns: string[],
): CatalogConstraint => ({
  conname,
  contype: 'f',
  convalidated: true,
  key_columns: columns,
  references_schema: 'public',
  references_table,
  references_columns,
  on_delete: 'r',
  on_update: 'a',
  definition: 'FOREIGN KEY placeholder',
});

function simple(
  conname: string,
  contype: string,
  columns: string[],
  definition = '',
): CatalogConstraint {
  return {
    conname, contype, key_columns: columns, definition,
    convalidated: true, references_schema: null, references_table: null,
    references_columns: [], on_delete: ' ', on_update: ' ',
  };
}

function complete(): CallKeyCatalog {
  return {
    tableExists: true,
    rlsEnabled: true,
    supportingIndexValid: true,
    columns: cols.map(([column_name, data_type]) =>
      ({ column_name, data_type, is_nullable: 'NO' })),
    migrationRecords: [],
    constraints: [
      simple('call_submission_keys_pkey', 'p', ['interpreter_id', 'request_key']),
      simple('call_submission_keys_call_session_unique', 'u', ['call_session_id']),
      fk('call_submission_keys_interpreter_fkey', ['interpreter_id'], 'interpreters', ['id']),
      fk('call_submission_keys_session_fkey', ['call_session_id'], 'call_sessions', ['id']),
      fk('call_submission_keys_session_ownership_fkey',
        ['call_session_id', 'interpreter_id'], 'call_sessions', ['id', 'interpreter_id']),
      simple('call_submission_keys_source_check', 'c', ['source'],
        "CHECK (source IN ('quick_log_action', 'quick_log_api', 'admin_manual'))"),
      simple('call_submission_keys_digest_check', 'c', ['payload_sha256'],
        "CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')"),
    ],
  };
}

describe('read-only call idempotency catalog diagnostics', () => {
  it('accepts only a complete structurally correct mapping', () => {
    expect(classifyCallKeySchema(complete())).toBe('complete');
  });

  it('reports a pristine database as absent', () => {
    expect(classifyCallKeySchema({
      ...complete(), tableExists: false, rlsEnabled: false,
      columns: [], constraints: [], supportingIndexValid: false,
    })).toBe('absent');
  });

  it('reports migration history contradicting an absent table as drift', () => {
    expect(classifyCallKeySchema({
      ...complete(), tableExists: false, rlsEnabled: false, supportingIndexValid: false,
      migrationRecords: [{
        migration_name: '20261118200000_call_submission_idempotency',
        succeeded: true, rolled_back: false,
      }],
    })).toBe('history-drift');
    expect(classifyCallKeySchema({
      ...complete(), tableExists: false, rlsEnabled: false,
      supportingIndexValid: true,
    })).toBe('history-drift');
  });

  it('does not treat a rolled-back migration as an applied one', () => {
    expect(classifyCallKeySchema({
      ...complete(), tableExists: false, supportingIndexValid: false,
      migrationRecords: [{
        migration_name: '20261118200000_call_submission_idempotency',
        succeeded: false, rolled_back: true,
      }],
    })).toBe('absent');
  });

  it('fails closed on missing RLS, index, or required columns', () => {
    const x = complete();
    expect(classifyCallKeySchema({ ...x, rlsEnabled: false })).toBe('partial');
    expect(classifyCallKeySchema({ ...x, supportingIndexValid: false })).toBe('partial');
    expect(classifyCallKeySchema({
      ...x, columns: x.columns.filter(row => row.column_name !== 'request_key'),
    })).toBe('partial');
    expect(classifyCallKeySchema({
      ...x, columns: x.columns.map(row => row.column_name === 'request_key'
        ? { ...row, data_type: 'text' } : row),
    })).toBe('partial');
    expect(classifyCallKeySchema({
      ...x, columns: x.columns.map(row => row.column_name === 'interpreter_id'
        ? { ...row, is_nullable: 'YES' } : row),
    })).toBe('partial');
  });

  it('detects independent FKs without same-interpreter ownership', () => {
    const x = complete();
    expect(classifyCallKeySchema({
      ...x,
      constraints: x.constraints.filter(row =>
        row.conname !== 'call_submission_keys_session_ownership_fkey'),
    })).toBe('partial');
    expect(classifyCallKeySchema({
      ...x,
      constraints: x.constraints.map(row =>
        row.conname === 'call_submission_keys_session_ownership_fkey'
          ? { ...row, references_columns: ['interpreter_id', 'id'] } : row),
    })).toBe('partial');
    expect(classifyCallKeySchema({
      ...x,
      constraints: x.constraints.map(row =>
        row.conname === 'call_submission_keys_session_ownership_fkey'
          ? { ...row, on_delete: 'c' } : row),
    })).toBe('partial');
  });

  it('rejects unvalidated constraints, wrong types and superficial CHECK names', () => {
    const x = complete();
    expect(classifyCallKeySchema({
      ...x,
      constraints: x.constraints.map(row =>
        row.conname === 'call_submission_keys_source_check'
          ? { ...row, definition: 'CHECK (true)' } : row),
    })).toBe('partial');
    expect(classifyCallKeySchema({
      ...x,
      constraints: x.constraints.map(row =>
        row.conname === 'call_submission_keys_digest_check'
          ? { ...row, definition: 'CHECK (payload_sha256 IS NOT NULL)' } : row),
    })).toBe('partial');
    expect(classifyCallKeySchema({
      ...x,
      constraints: x.constraints.map(row =>
        row.conname === 'call_submission_keys_interpreter_fkey'
          ? { ...row, convalidated: false } : row),
    })).toBe('partial');
  });

  it('a successful historical entry does not prove the full live schema', () => {
    const x = complete();
    expect(classifyCallKeySchema({
      ...x, rlsEnabled: false,
      migrationRecords: [{
        migration_name: '20261118213000_call_submission_session_ownership',
        succeeded: true, rolled_back: false,
      }],
    })).toBe('partial');
  });
});
