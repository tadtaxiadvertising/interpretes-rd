// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import {
  classifyRoleplayReservationCatalog,
  readRoleplayReservationCatalog,
  type RoleplayReservationCatalog,
} from './roleplay-upload-reservation-schema-catalog';

function fixture(): RoleplayReservationCatalog {
  return {
    tableExists: true, rlsEnabled: true,
    policyCount: 0, publicGrantCount: 0,
    columns: [
      ['id', 'uuid', null, null],
      ['actor_user_id', 'text', null, null],
      ['request_key', 'uuid', null, null],
      ['declaration_hash', 'character varying', 64, null],
      ['status', 'character varying', 20, "'RESERVED'::character varying"],
      ['items', 'jsonb', null, null],
      ['verified_objects', 'jsonb', null, "'[]'::jsonb"],
      ['created_at', 'timestamp with time zone', null, 'CURRENT_TIMESTAMP'],
      ['expires_at', 'timestamp with time zone', null, null],
    ].map(([name, type, maxLength, defaultValue]) => ({
      name: name as string, type: type as string, maxLength: maxLength as number | null,
      defaultValue: defaultValue as string | null, nullable: false,
    })),
    constraints: [
      ['roleplay_upload_reservations_pkey', 'p', ['id'], 'PRIMARY KEY (id)'],
      ['roleplay_upload_reservations_actor_key', 'u', ['actor_user_id', 'request_key'], 'UNIQUE (actor_user_id, request_key)'],
      ['roleplay_upload_reservations_owner_check', 'c', [], 'CHECK ((length(btrim(actor_user_id)) > 0))'],
      ['roleplay_upload_reservations_digest_check', 'c', [], "CHECK ((declaration_hash ~ '^[a-f0-9]{64}$'::text))"],
      ['roleplay_upload_reservations_status_check', 'c', [], 'CHECK ((status IS NOT NULL))'],
      ['roleplay_upload_reservations_expiry_check', 'c', [], 'CHECK ((expires_at > created_at))'],
      ['roleplay_upload_reservations_items_check', 'c', [], 'CHECK ((jsonb_array_length(items) > 0))'],
      ['roleplay_upload_reservations_evidence_check', 'c', [], 'CHECK ((jsonb_array_length(verified_objects) >= 0))'],
    ].map(([name, kind, cols, definition]) => ({
      name: name as string, kind: kind as string, columns: cols as string[],
      definition: definition as string, validated: true,
    })),
  };
}

describe('future Roleplay reservation schema catalog gate (no SQL changes)', () => {
  it('distinguishes absent and catalog-ready schema', () => {
    const ready = fixture();
    expect(classifyRoleplayReservationCatalog(ready)).toBe('catalog-ready');
    expect(classifyRoleplayReservationCatalog({
      ...ready, tableExists: false, columns: [], constraints: [],
    })).toBe('absent');
  });

  it('fails closed if RLS, privileges, policies, defaults, columns or unique key drift', () => {
    const ready = fixture();
    const failures: RoleplayReservationCatalog[] = [
      { ...ready, rlsEnabled: false },
      { ...ready, policyCount: 1 },
      { ...ready, publicGrantCount: 1 },
      { ...ready, columns: ready.columns.slice(1) },
      { ...ready, columns: ready.columns.map(c => c.name === 'declaration_hash'
        ? { ...c, maxLength: 128 } : c) },
      { ...ready, columns: ready.columns.map(c => c.name === 'created_at'
        ? { ...c, defaultValue: null } : c) },
      { ...ready, columns: ready.columns.map(c => c.name === 'expires_at'
        ? { ...c, nullable: true } : c) },
      { ...ready, constraints: ready.constraints.slice(1) },
      { ...ready, constraints: ready.constraints.map(c => c.kind === 'u'
        ? { ...c, columns: ['request_key'] } : c) },
      { ...ready, constraints: ready.constraints.map(c => c.kind === 'c'
        ? { ...c, validated: false } : c) },
      { ...ready, constraints: ready.constraints.map(c =>
        c.name.endsWith('digest_check')
          ? { ...c, definition: 'CHECK ((declaration_hash IS NOT NULL OR TRUE))' } : c) },
    ];
    for (const broken of failures) {
      expect(classifyRoleplayReservationCatalog(broken)).toBe('incomplete');
    }
  });

  it('returns only absence without inspecting unrelated user tables', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const value = await readRoleplayReservationCatalog({ query } as unknown as Pick<Client, 'query'>);
    expect(value.tableExists).toBe(false);
    expect(classifyRoleplayReservationCatalog(value)).toBe('absent');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('to_regclass');
  });

  it('reads only PostgreSQL metadata and never data rows or object names', async () => {
    const ready = fixture();
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ rls: true }] })
      .mockResolvedValueOnce({ rows: ready.columns })
      .mockResolvedValueOnce({ rows: ready.constraints })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });
    const actual = await readRoleplayReservationCatalog({ query } as unknown as Pick<Client, 'query'>);
    expect(classifyRoleplayReservationCatalog(actual)).toBe('catalog-ready');
    expect(query).toHaveBeenCalledTimes(5);
    for (const [sql] of query.mock.calls) {
      expect(String(sql)).not.toMatch(/SELECT\s+\*\s+FROM\s+public\.roleplay_upload_reservations/i);
      expect(String(sql)).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bALTER\b/i);
    }
  });
});
