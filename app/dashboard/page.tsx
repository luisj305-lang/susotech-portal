import { DashboardClient } from "@/components/dashboard-client";
import { requireProfile } from "@/lib/auth/session";
import { getMyWeeklyProduction } from "@/lib/jobs/queries";
import { requireActiveShiftPage } from "@/lib/work-shifts/access";

export default async function DashboardPage() {
  const profile = await requireProfile();
  await requireActiveShiftPage();
  const weeklyProduction = profile.role === "tecnico" ? await getMyWeeklyProduction() : [];
  return <DashboardClient profile={profile} weeklyProduction={weeklyProduction} />;
}
