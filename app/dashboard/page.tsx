import { DashboardClient } from "@/components/dashboard-client";
import { requireProfile } from "@/lib/auth/session";
import { getMyWeeklyProduction } from "@/lib/jobs/queries";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const weeklyProduction = profile.role === "tecnico" ? await getMyWeeklyProduction() : [];
  return <DashboardClient profile={profile} weeklyProduction={weeklyProduction} />;
}
