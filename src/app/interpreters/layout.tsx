import { DashboardShell } from "@/components/DashboardShell";
import { getCurrentProfile } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function InterpretersLayout({ children }: { children: React.ReactNode }) {

  const profile = await getCurrentProfile();

  return (
    <DashboardShell role="admin" userName={profile?.display_name || "Administrador"}>
      {children}
    </DashboardShell>
  );
}
