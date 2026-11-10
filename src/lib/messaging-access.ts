const ADMIN_ROLES = new Set(['admin']);
const INTERPRETER_ROLES = new Set(['interpreter']);

export function canAccessChat(currentRole: string | null | undefined, otherRole: string | null | undefined): boolean {
  const current = currentRole?.toLowerCase();
  const other = otherRole?.toLowerCase();

  if (!current || !other) return false;
  if (ADMIN_ROLES.has(current)) return INTERPRETER_ROLES.has(other) || ADMIN_ROLES.has(other);
  return INTERPRETER_ROLES.has(current) && ADMIN_ROLES.has(other);
}
