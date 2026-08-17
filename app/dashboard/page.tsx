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

function referenceDateForWeek(weekOffset: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(Date.now() + weekOffset * 7 * 24 * 60 * 60 * 1000),
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile();
  const values = await searchParams;
  const rawWeek = Array.isArray(values.week) ? values.week[0] : values.week;
  const weekOffset = Number.isFinite(Number(rawWeek)) ? Number(rawWeek) : 0;

  if (profile.role === "tecnico") {
    const shiftAccess = await getWorkShiftAccess();
    const referenceDate = referenceDateForWeek(weekOffset);
    const weeklyProduction = await getMyWeeklyProduction(referenceDate);
    const weeklyFinancial = await getMyWeeklyFinancialAllocations(referenceDate);
    return <>
      <DashboardClient profile={profile} weeklyProduction={weeklyProduction} weeklyFinancial={weeklyFinancial} weekOffset={weekOffset} />
      <ShiftStartPrompt technicianId={profile.id} active={shiftAccess.active} />
    </>;
  }

  const referenceAt = referenceAtForWeek(weekOffset);

  const [workerOperations, pendingReview] = await Promise.all([
    getWorkerOperationsDashboard(referenceAt),
    listOfficeJobs({ status: "en_revision" }),
  ]);

  return <AdminDashboard profile={profile} workerOperations={workerOperations} pendingReview={pendingReview} weekOffset={weekOffset} />;
}
