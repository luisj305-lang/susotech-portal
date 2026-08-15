import { DashboardClient } from "@/components/dashboard-client";
import { requireProfile } from "@/lib/auth/session";
import { getMyWeeklyFinancialAllocations, getMyWeeklyProduction, getWorkerOperationsDashboard } from "@/lib/jobs/queries";
import { getWorkShiftAccess } from "@/lib/work-shifts/access";
import { ShiftStartPrompt } from "@/components/work-shifts/shift-start-prompt";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const shiftAccess = await getWorkShiftAccess();
  const weeklyProduction = profile.role === "tecnico" ? await getMyWeeklyProduction() : [];
  const weeklyFinancial = profile.role === "tecnico" ? await getMyWeeklyFinancialAllocations() : [];
  const workerOperations = profile.role === "tecnico" ? [] : await getWorkerOperationsDashboard();
  return <>
    <DashboardClient profile={profile} weeklyProduction={weeklyProduction} weeklyFinancial={weeklyFinancial} workerOperations={workerOperations} />
    {profile.role === "tecnico" && <ShiftStartPrompt technicianId={profile.id} active={shiftAccess.active} />}
  </>;
}
