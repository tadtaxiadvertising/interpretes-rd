import { DashboardShell } from "@/components/DashboardShell";
import { getCurrentProfile } from "@/app/actions/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProductionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  // Production operations and imported logs are administrative data.
  if (!profile) {
    redirect("/login");
  }

  if (profile.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <DashboardShell role="admin" userName={profile.display_name || "Admin"}>
      {children}
    </DashboardShell>
  );
}
