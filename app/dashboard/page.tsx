import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { DashboardClient } from "@/components/dashboard-client";
import { requireProfile } from "@/lib/auth/session";
import { getMyWeeklyFinancialAllocations, getMyWeeklyProduction, getWorkerOperationsDashboard, listOfficeJobs } from "@/lib/jobs/queries";
import { getWorkShiftAccess } from "@/lib/work-shifts/access";
import { ShiftStartPrompt } from "@/components/work-shifts/shift-start-prompt";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function referenceAtForWeek(weekOffset: number): string {
  return new Date(Date.now() + weekOffset * 7 * 24 * 60 * 60 * 1000).toISOString();
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile();

  if (profile.role === "tecnico") {
    const shiftAccess = await getWorkShiftAccess();
    const weeklyProduction = await getMyWeeklyProduction();
    const weeklyFinancial = await getMyWeeklyFinancialAllocations();
    return <>
      <DashboardClient profile={profile} weeklyProduction={weeklyProduction} weeklyFinancial={weeklyFinancial} />
      <ShiftStartPrompt technicianId={profile.id} active={shiftAccess.active} />
    </>;
  }

  const values = await searchParams;
  const rawWeek = Array.isArray(values.week) ? values.week[0] : values.week;
  const weekOffset = Number.isFinite(Number(rawWeek)) ? Number(rawWeek) : 0;
  const referenceAt = referenceAtForWeek(weekOffset);

  const [workerOperations, pendingReview] = await Promise.all([
    getWorkerOperationsDashboard(referenceAt),
    listOfficeJobs({ status: "enviado_revision" }),
  ]);

  return <AdminDashboard profile={profile} workerOperations={workerOperations} pendingReview={pendingReview} weekOffset={weekOffset} />;
}
