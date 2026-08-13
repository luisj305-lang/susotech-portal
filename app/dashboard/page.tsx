import { DashboardClient } from "@/components/dashboard-client";
import { requireProfile } from "@/lib/auth/session";
import { getMyWeeklyProduction, getWorkerOperationsDashboard } from "@/lib/jobs/queries";
import { requireActiveShiftPage } from "@/lib/work-shifts/access";

export default async function DashboardPage() {
  const profile = await requireProfile();
  await requireActiveShiftPage();
  const weeklyProduction = profile.role === "tecnico" ? await getMyWeeklyProduction() : [];
  const workerOperations = profile.role === "tecnico" ? [] : await getWorkerOperationsDashboard();
  return <DashboardClient profile={profile} weeklyProduction={weeklyProduction} workerOperations={workerOperations} />;
}
