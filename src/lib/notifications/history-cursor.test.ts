import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { HistoryCursorSchema, readHistoryCursorPage } from './history-cursor';

const recipient = '123e4567-e89b-42d3-a456-426614174000';
const precise = '2026-11-25T20:30:00.123456Z';
const row = { id: 'notice', title: 'Aviso', message: 'Mensaje', type: 'info', isRead: false, createdAt: new Date(precise), link: null, category: 'system', cursorTime: precise };

function fixture(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue(rows);
  const db = { $queryRaw: query } as Pick<Prisma.TransactionClient, '$queryRaw'>;
  return { db, query, sql: () => query.mock.calls[0][0] as Prisma.Sql };
}

describe('notification history cursor', () => {
  it('preserves microseconds and strips internal cursor metadata from public rows', async () => {
    const f = fixture(Array.from({ length: 21 }, (_, i) => ({ ...row, id: 'n' + i })));
    const result = await readHistoryCursorPage(f.db, [recipient], false, { unreadOnly: false, after: null });
    expect(result.rows).toHaveLength(20);
    expect(result.rows[0]).not.toHaveProperty('cursorTime');
    expect(result.nextCursor).toEqual({ id: 'n19', createdAt: precise });
    expect(f.sql().sql).toContain('ORDER BY n.created_at DESC NULLS LAST, n.id DESC');
    expect(f.sql().sql).toContain('LIMIT 21');
    expect(f.sql().sql).not.toContain('OFFSET');
  });

  it('uses exact date/id comparisons and includes older null-dated records', async () => {
    const f = fixture();
    await readHistoryCursorPage(f.db, [recipient], false, { unreadOnly: true, importantOnly: true, category: 'system', after: { id: 'n19', createdAt: precise } });
    expect(f.sql().sql).toContain('n.user_id IN (?::uuid)');
    expect(f.sql().sql).toContain('(n.is_read = false OR n.is_read IS NULL)');
    expect(f.sql().sql).toContain('n.category IS NULL');
    expect(f.sql().sql).toContain("n.type IN ('warning', 'error')");
    expect(f.sql().sql).toContain('n.created_at < ?::timestamptz OR n.created_at IS NULL');
    expect(f.sql().sql).toContain('n.created_at = ?::timestamptz AND n.id < ?');
    expect(f.sql().values).toContain(recipient);
    expect(f.sql().values.filter(v => v === precise)).toHaveLength(2);
    expect(f.sql().values).toContain('n19');
  });

  it('continues null-dated history by ID alone and retains candidate scope', async () => {
    const f = fixture();
    await readHistoryCursorPage(f.db, [recipient], true, { unreadOnly: false, after: { id: 'null-row', createdAt: null } });
    expect(f.sql().sql).toContain("n.category = 'recruitment' AND n.link = '/candidate'");
    expect(f.sql().sql).toContain('n.created_at IS NULL AND n.id < ?');
    expect(f.sql().values).toContain('null-row');
  });

  it('never queries a missing recipient or prohibited candidate category', async () => {
    const f = fixture();
    expect(await readHistoryCursorPage(f.db, [], false, { unreadOnly: false, after: null })).toEqual({ rows: [], nextCursor: null });
    expect(await readHistoryCursorPage(f.db, [recipient], true, { unreadOnly: false, category: 'finance', after: null })).toEqual({ rows: [], nextCursor: null });
    expect(f.query).not.toHaveBeenCalled();
  });

  it('validates cursor shape and rejects unexpected identity fields or malformed time', () => {
    expect(HistoryCursorSchema.safeParse({ id: 'n1', createdAt: precise }).success).toBe(true);
    expect(HistoryCursorSchema.safeParse({ id: 'n1', createdAt: null }).success).toBe(true);
    expect(HistoryCursorSchema.safeParse({ id: 'n1', createdAt: 'invalid' }).success).toBe(false);
    expect(HistoryCursorSchema.safeParse({ id: 'n1', createdAt: precise, userId: recipient }).success).toBe(false);
    expect(HistoryCursorSchema.safeParse({ id: '', createdAt: precise }).success).toBe(false);
  });
  it('binds literal search and inclusive local date filters without expanding recipient scope', async () => {
    const f = fixture();
    const search = "QA %_' OR 1=1";
    await readHistoryCursorPage(f.db, [recipient], true, { unreadOnly: true, after: null, search, fromDate: '2026-11-01', toDate: '2026-11-25' });
    expect(f.sql().sql).toContain('n.user_id IN (?::uuid)');
    expect(f.sql().sql).toContain("n.category = 'recruitment' AND n.link = '/candidate'");
    expect(f.sql().sql).toContain('strpos(lower(n.title), lower(?::text))');
    expect(f.sql().sql).toContain('strpos(lower(n.message), lower(?::text))');
    expect(f.sql().sql).toContain("n.created_at >= (?::date::timestamp AT TIME ZONE 'America/Santo_Domingo')");
    expect(f.sql().sql).toContain("n.created_at < ((?::date + 1)::timestamp AT TIME ZONE 'America/Santo_Domingo')");
    expect(f.sql().sql).not.toContain(search);
    expect(f.sql().values).toEqual([recipient, search, search, '2026-11-01', '2026-11-25']);
  });
});
