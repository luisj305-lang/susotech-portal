import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { DashboardClient } from "@/components/dashboard-client";
import { requireProfile } from "@/lib/auth/session";
import { getMyWeeklyFinancialAllocations, getMyWeeklyProduction, getWeeklyInvoicedTotal, getWorkerOperationsDashboard, listOfficeJobs } from "@/lib/jobs/queries";
import { getWorkShiftAccess } from "@/lib/work-shifts/access";
import { ShiftStartPrompt } from "@/components/work-shifts/shift-start-prompt";
import { getMyPrimaryVehicleLabel } from "@/lib/fleet/technician-queries";

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
    const referenceDate = referenceDateForWeek(weekOffset);
    const [shiftAccess, weeklyProduction, weeklyFinancial, vehicleLabel] = await Promise.all([
      getWorkShiftAccess(),
      getMyWeeklyProduction(referenceDate),
      getMyWeeklyFinancialAllocations(referenceDate),
      getMyPrimaryVehicleLabel(),
    ]);
    return <>
      <DashboardClient profile={profile} weeklyProduction={weeklyProduction} weeklyFinancial={weeklyFinancial} weekOffset={weekOffset} />
      <ShiftStartPrompt technicianId={profile.id} active={shiftAccess.active} vehicleLabel={vehicleLabel} />
    </>;
  }

  const referenceAt = referenceAtForWeek(weekOffset);

  const [workerOperations, pendingReview, weeklyInvoiced] = await Promise.all([
    getWorkerOperationsDashboard(referenceAt),
    listOfficeJobs({ status: "en_revision" }),
    getWeeklyInvoicedTotal(referenceAt),
  ]);

  return <AdminDashboard profile={profile} workerOperations={workerOperations} pendingReview={pendingReview} weeklyInvoiced={weeklyInvoiced} weekOffset={weekOffset} />;
}
