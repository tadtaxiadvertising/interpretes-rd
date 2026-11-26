import { safeNotificationLink } from './safe-notification-link';

// Known landing pages from the portal navigation and operational publishers.
// Do not guess nested paths or expose old token-bearing roleplay URLs.
const ADMIN_DESTINATIONS = new Set([
  '/admin', '/interpreters', '/recruitment', '/admin/roleplays',
  '/admin/roleplays/studio', '/admin/roleplays/library', '/admin/roleplay-audio-jobs',
  '/live', '/production', '/admin/clients', '/admin/accounts', '/admin/companies',
  '/admin/assignments', '/admin/reports', '/admin/reconciliation', '/admin/platforms',
  '/admin/calendar', '/admin/production/manual', '/qa', '/admin/legal-agreements',
  '/payroll', '/admin/messages', '/settings', '/settings/import',
]);
const INTERPRETER_DESTINATIONS = new Set([
  '/dashboard', '/dashboard/roleplays', '/dashboard/calendar', '/dashboard/ranking',
  '/dashboard/earnings', '/dashboard/messages', '/dashboard/settings', '/live', '/onboarding',
]);

/** Presentation policy, not an authorization check for the destination page.
 * Keep the original notice and read state; suppress obsolete or inappropriate links.
 */
export function notificationDestination(value: unknown, role: unknown, category: unknown): string | null {
  const path = safeNotificationLink(value);
  if (!path) return null;
  if (role === 'candidate') return category === 'recruitment' && path === '/candidate' ? path : null;
  if (role !== 'admin' && role !== 'interpreter') return null;
  if (category === 'messaging' && (path === '/admin/messages' || path === '/dashboard/messages')) {
    return role === 'admin' ? '/admin/messages' : '/dashboard/messages';
  }
  const allowed = role === 'admin' ? ADMIN_DESTINATIONS : INTERPRETER_DESTINATIONS;
  return allowed.has(path) ? path : null;
}
