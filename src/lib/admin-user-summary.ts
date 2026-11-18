import type { UserProfile } from '@prisma/client';

// Only fields required by the admin users table/actions may cross the
// server-to-client boundary. Never include onboarding identity or bank details.
export type AdminUserSummary = Pick<
  UserProfile,
  'id' | 'email' | 'displayName' | 'role' |
  'interpreterId' | 'onboardingComplete' | 'createdAt'
>;

export type AdminUserWithInterpreter = AdminUserSummary & {
  interpreter: { id: number; name: string; campaign: string | null } | null;
};
