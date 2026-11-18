import type { UserRole } from '@/lib/types';

export const PROTECTED_ADMIN_EMAILS = ['interpretersfree@gmail.com'] as const;

export function normalizeEmail(email: string | null | undefined) {
  return (email || '').toLowerCase().trim();
}

export function isProtectedAdminEmail(email: string | null | undefined) {
  return PROTECTED_ADMIN_EMAILS.includes(normalizeEmail(email) as (typeof PROTECTED_ADMIN_EMAILS)[number]);
}

export function resolveUserRoleByEmail(
  email: string | null | undefined,
  fallbackRole: UserRole | string | null | undefined = 'interpreter'
): UserRole {
  if (isProtectedAdminEmail(email)) return 'admin';
  const normalizedFallback = fallbackRole?.toLowerCase();
  if (normalizedFallback === 'candidate') return 'candidate';
  return normalizedFallback === 'admin' ? 'admin' : 'interpreter';
}

/**
 * The Auth.js session callback clears its role when the underlying RBAC
 * identity no longer exists. Never manufacture an interpreter/admin role
 * from such a session (or from an unrelated Supabase profile).
 */
export function hasAuthoritativeAuthJsRole(role: unknown): role is string {
  return typeof role === 'string' &&
    (role.toUpperCase() === 'ADMIN' ||
     role.toUpperCase() === 'HOLDER' ||
     role.toUpperCase() === 'INTERPRETER');
}

export function resolveRbacRoleByEmail(
  email: string | null | undefined,
  fallbackRole: string | null | undefined = 'INTERPRETER'
): 'ADMIN' | 'HOLDER' | 'INTERPRETER' {
  if (isProtectedAdminEmail(email)) return 'ADMIN';
  return fallbackRole === 'ADMIN' || fallbackRole === 'HOLDER' ? fallbackRole : 'INTERPRETER';
}
