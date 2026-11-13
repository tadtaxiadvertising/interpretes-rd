import type { Prisma, RoleplayStatus } from '@prisma/client';

export const ADMIN_ROLEPLAY_PAGE_SIZE = 20;
export const ADMIN_ROLEPLAY_FILTERABLE_STATUSES = [
  'DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED',
  'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED', 'EXPIRED', 'CANCELLED',
] as const satisfies readonly RoleplayStatus[];

export type AdminRoleplaySearchParams = {
  search?: string;
  status?: string;
  participantType?: string;
  page?: string;
};

export function parseAdminRoleplayFilters(params: AdminRoleplaySearchParams) {
  const search = (params.search ?? '').trim().slice(0, 100);
  const status: RoleplayStatus | 'all' =
    ADMIN_ROLEPLAY_FILTERABLE_STATUSES.find(value => value === params.status) ?? 'all';
  const participantType = params.participantType === 'candidate' || params.participantType === 'interpreter'
    ? params.participantType : 'all';
  const parsedPage = Number(params.page);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0
    ? Math.min(parsedPage, 100000) : 1;
  return { search, status, participantType, page };
}

export type AdminRoleplayFilters = ReturnType<typeof parseAdminRoleplayFilters>;

/**
 * A historical recruitment session can contain both identifiers.
 * Recruitment ownership takes precedence; never count those sessions as
 * interpreter practice just because an old interpreterId was retained.
 */
export function buildAdminRoleplayWhere(filters: AdminRoleplayFilters): Prisma.RoleplaySessionWhereInput {
  const where: Prisma.RoleplaySessionWhereInput = {};
  if (filters.status !== 'all') where.status = filters.status;
  if (filters.participantType === 'interpreter') {
    where.interpreterId = { not: null };
    where.recruitmentCandidateId = null;
  }
  if (filters.participantType === 'candidate') where.recruitmentCandidateId = { not: null };
  if (filters.search) {
    where.OR = [
      { interpreter: { name: { contains: filters.search, mode: 'insensitive' } } },
      { interpreter: { emailCorporativo: { contains: filters.search, mode: 'insensitive' } } },
      { interpreter: { externalId: { contains: filters.search, mode: 'insensitive' } } },
      { recruitmentCandidate: { name: { contains: filters.search, mode: 'insensitive' } } },
      { recruitmentCandidate: { email: { contains: filters.search, mode: 'insensitive' } } },
    ];
  }
  return where;
}

/** Keep SQL OFFSET and the visible page number in sync, even with stale URLs. */
export function boundAdminRoleplayPage(requestedPage: number, total: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / ADMIN_ROLEPLAY_PAGE_SIZE));
  return Number.isSafeInteger(requestedPage) && requestedPage >= 1
    ? Math.min(requestedPage, pages) : 1;
}
