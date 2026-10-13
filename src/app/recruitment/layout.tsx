import { DashboardShell } from "@/components/DashboardShell";
import { getCurrentProfile } from "@/app/actions/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function RecruitmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  // Recruitment data includes candidate PII and is an administrative surface.
  // Never render it for anonymous users or non-admin roles.
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
