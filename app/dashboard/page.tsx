import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { DashboardClient } from "@/components/dashboard-client";
import { requireProfile } from "@/lib/auth/session";
import { getMyWeeklyFinancialAllocations, getMyWeeklyProduction, getWeeklyInvoicedTotal, getWorkerOperationsDashboard, listOfficeJobs, listTechnicianQueueJobs } from "@/lib/jobs/queries";
import { getWorkShiftAccess } from "@/lib/work-shifts/access";
import { getMyHourlyPayrollSummary } from "@/lib/work-shifts/queries";
import { ShiftStartPrompt } from "@/components/work-shifts/shift-start-prompt";
import { getMyPrimaryVehicleLabel } from "@/lib/fleet/technician-queries";
import { getMyManualJobs, getMyWeeklyManualEarnings, getOfficeManualJobs } from "@/lib/manual-jobs/queries";
import { referenceAtForNewYorkWeek, referenceDateForNewYorkWeek } from "@/lib/time/new-york-week";
import { filterManualWork, isInWorkWeek } from "@/lib/jobs/work-list";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function referenceAtForWeek(weekOffset: number): string {
  return new Date(Date.now() + weekOffset * 7 * 24 * 60 * 60 * 1000).toISOString();
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile();
  const values = await searchParams;
  const rawWeek = Array.isArray(values.week) ? values.week[0] : values.week;
  const weekOffset = Number.isFinite(Number(rawWeek)) ? Number(rawWeek) : 0;

  if (profile.role === "tecnico") {
    const referenceDate = referenceDateForNewYorkWeek(weekOffset);
    const [shiftAccess, weeklyProduction, weeklyFinancial, vehicleLabel, hourlySummary, weeklyManualEarnings, manualJobs] = await Promise.all([
      getWorkShiftAccess(),
      getMyWeeklyProduction(referenceDate),
      getMyWeeklyFinancialAllocations(referenceDate),
      getMyPrimaryVehicleLabel(),
      getMyHourlyPayrollSummary(),
      getMyWeeklyManualEarnings(referenceDate),
      getMyManualJobs(),
    ]);
    const referenceAt = new Date(referenceAtForNewYorkWeek(weekOffset));
    const regularJobs = shiftAccess.active ? await listTechnicianQueueJobs({ tab: "todos" }) : [];
    const jobs = regularJobs.filter((job) => isInWorkWeek(job.assignedAt, referenceAt));
    const weeklyManualJobs = filterManualWork(manualJobs, { referenceAt });
    return <>
      <DashboardClient profile={profile} weeklyProduction={weeklyProduction} weeklyFinancial={weeklyFinancial} weeklyManualEarnings={weeklyManualEarnings} jobs={jobs} manualJobs={weeklyManualJobs} weekOffset={weekOffset} hourlySummary={hourlySummary} />
      <ShiftStartPrompt technicianId={profile.id} active={shiftAccess.active} vehicleLabel={vehicleLabel} />
    </>;
  }

  const referenceAt = referenceAtForWeek(weekOffset);

  const [workerOperations, pendingReview, weeklyInvoiced, manualJobs] = await Promise.all([
    getWorkerOperationsDashboard(referenceAt),
    listOfficeJobs({ status: "en_revision" }),
    getWeeklyInvoicedTotal(referenceAt),
    getOfficeManualJobs(),
  ]);

  const workReference = new Date(workerOperations[0]?.week_start_at ?? referenceAt);
  return <AdminDashboard profile={profile} workerOperations={workerOperations} pendingReview={pendingReview.filter((job) => isInWorkWeek(job.assignedAt, workReference))} manualJobs={filterManualWork(manualJobs, { referenceAt: workReference })} weeklyInvoiced={weeklyInvoiced} weekOffset={weekOffset} />;
}
