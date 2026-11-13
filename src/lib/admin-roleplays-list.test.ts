import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROLEPLAY_PAGE_SIZE,
  boundAdminRoleplayPage,
  buildAdminRoleplayWhere,
  parseAdminRoleplayFilters,
} from './admin-roleplays-list';

describe('Admin roleplay ownership filters and pagination', () => {
  it('excludes candidate sessions that still retain a legacy interpreterId', () => {
    const where = buildAdminRoleplayWhere(parseAdminRoleplayFilters({
      participantType: 'interpreter',
    }));
    expect(where).toEqual({
      interpreterId: { not: null },
      recruitmentCandidateId: null,
    });
  });

  it('routes sessions with both IDs to candidates, never interpreter practice', () => {
    const where = buildAdminRoleplayWhere(parseAdminRoleplayFilters({
      participantType: 'candidate',
    }));
    expect(where).toEqual({ recruitmentCandidateId: { not: null } });
  });

  it('preserves status and search filters while applying participant ownership', () => {
    const filters = parseAdminRoleplayFilters({
      participantType: 'interpreter',
      status: 'SUBMITTED',
      search: '   ana  ',
      page: '4',
    });
    const where = buildAdminRoleplayWhere(filters);
    expect(filters.page).toBe(4);
    expect(where.status).toBe('SUBMITTED');
    expect(where.recruitmentCandidateId).toBeNull();
    expect(where.interpreterId).toEqual({ not: null });
    expect(where.OR).toHaveLength(5);
    expect(JSON.stringify(where.OR)).toContain('"contains":"ana"');
  });

  it('treats untrusted role/status/page values as non-authoritative', () => {
    const parsed = parseAdminRoleplayFilters({
      participantType: 'admin', status: 'NOT_A_STATUS', page: '-50',
    });
    expect(parsed).toEqual({ search: '', status: 'all', participantType: 'all', page: 1 });
    expect(parseAdminRoleplayFilters({ page: 'Infinity' }).page).toBe(1);
    expect(parseAdminRoleplayFilters({ page: '99999999999999999' }).page).toBe(1);
  });

  it('clamps a stale page before SQL OFFSET and supports empty results', () => {
    expect(ADMIN_ROLEPLAY_PAGE_SIZE).toBe(20);
    expect(boundAdminRoleplayPage(999, 35)).toBe(2);
    expect(boundAdminRoleplayPage(1, 35)).toBe(1);
    expect(boundAdminRoleplayPage(20, 0)).toBe(1);
    expect(boundAdminRoleplayPage(3, 41)).toBe(3);
    expect(boundAdminRoleplayPage(NaN, 35)).toBe(1);
  });
});
