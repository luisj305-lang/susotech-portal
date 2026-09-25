import { AppShell } from "@/components/dashboard/app-shell";
import { OfficePayrollTable } from "@/components/payroll/office-payroll-table";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { requireOfficeViewer } from "@/lib/auth/session";
import { getOfficeHourlyPayroll } from "@/lib/payroll/queries";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NominaPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const profile = await requireOfficeViewer();
  const values = await searchParams;
  const rawWeek = Array.isArray(values.week) ? values.week[0] : values.week;
  const weekOffset = Number.isFinite(Number(rawWeek)) ? Number(rawWeek) : 0;

  const data = await getOfficeHourlyPayroll(weekOffset);

  return (
    <AppShell
      role={profile.role as "admin" | "supervisor"}
      userName={displayName(profile)}
      roleLabel={roleLabel(profile.role)}
      initials={initials(profile)}
    >
      <OfficePayrollTable
        isAdmin={profile.role === "admin"}
        data={data}
        weekOffset={weekOffset}
      />
    </AppShell>
  );
}
