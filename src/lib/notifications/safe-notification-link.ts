// Only known application modules, never authentication, API or external URLs.
const MODULE_ROOTS = [
  '/candidate', '/admin', '/dashboard', '/interpreters', '/recruitment', '/production',
  '/qa', '/payroll', '/settings', '/live', '/roleplays', '/onboarding',
];

export function safeNotificationLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500 || !value.startsWith('/') ||
      value.startsWith('//') || value.includes('\\') || [...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return null;
  // Keep only the destination path: query strings and fragments may contain
  // credentials, redirect parameters or other private transient metadata.
  const path = value.split(/[?#]/, 1)[0];
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(path) || path.includes('//')) return null;
  return MODULE_ROOTS.some(root => path === root || path.startsWith(root + '/')) ? path : null;
}
