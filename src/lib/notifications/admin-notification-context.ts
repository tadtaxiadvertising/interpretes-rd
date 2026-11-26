import 'server-only';
import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/auth/current-actor';
import { getCurrentProfile } from '@/app/actions/auth';
import { authorizedNotificationRecipientIds } from './authorized-recipient-ids';
import { loadNavbarUnreadCount } from './load-navbar-unread-count';
import { loadNavbarNotifications } from './load-navbar-notifications';
import { notificationPreferenceScope } from './notification-preference-scope';

/** Resolve the same trusted actor used by notification server actions.
 * Never combine a legacy auth bridge identity with a different linked profile.
 */
export async function requireAdminNotificationContext() {
  const actor = await getCurrentActor();
  if (!actor) redirect('/login');
  if (actor.role !== 'admin') redirect('/dashboard');
  if (!actor.profileId) redirect('/login');
  const profile = await getCurrentProfile();
  if (!profile || profile.id !== actor.profileId) redirect('/login');
  if (profile.role !== 'admin') redirect('/dashboard');

  const recipientIds = authorizedNotificationRecipientIds(actor.userId, actor.profileId);
  const [notifications, notificationUnreadCount] = await Promise.all([
    loadNavbarNotifications(recipientIds, { role: 'admin' }), loadNavbarUnreadCount(recipientIds),
  ]);
  return {
    userName: profile.display_name || 'Administrador',
    notifications,
    notificationUnreadCount,
    notificationPreferenceScope: notificationPreferenceScope(actor.userId, 'admin'),
  };
}
