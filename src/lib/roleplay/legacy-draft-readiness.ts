import type { Prisma } from '@prisma/client';

/**
 * Before individual publication used INVITED, completed assignments were
 * stored as DRAFT. Keep those visible without exposing empty reservations.
 * This checks persisted metadata, not live Storage availability.
 */
export const legacyRoleplayDraftReady = {
  scenarios: {
    some: {},
    none: { baseAudioUrl: '' },
  },
} satisfies Prisma.RoleplaySessionWhereInput;

export const interpreterRoleplayVisibility = {
  OR: [
    { status: { not: 'DRAFT' } },
    { status: 'DRAFT', ...legacyRoleplayDraftReady },
  ],
} satisfies Prisma.RoleplaySessionWhereInput;
