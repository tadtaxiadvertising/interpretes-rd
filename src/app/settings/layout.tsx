import { auth } from "@/lib/auth";
import { authorizedNotificationRecipientIds } from "@/lib/notifications/authorized-recipient-ids";
import { loadNavbarNotifications } from "@/lib/notifications/load-navbar-notifications";
import { notificationPreferenceScope } from "@/lib/notifications/notification-preference-scope";
import { DashboardShell } from "@/components/DashboardShell";
import { getCurrentProfile } from "@/app/actions/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {

  const profile = await getCurrentProfile();

  if (!profile) {
    redirect('/login');
  }

  if (profile.role !== 'admin') {
    redirect('/dashboard');
  }

  const { userId } = await auth();
  const notifications = userId ? await loadNavbarNotifications(authorizedNotificationRecipientIds(userId, profile.id)) : [];

  return (
    <DashboardShell role="admin" userName={profile.display_name || "Administrador"} notifications={notifications} notificationPreferenceScope={notificationPreferenceScope(userId, "admin")}>
      {children}
    </DashboardShell>
  );
}
