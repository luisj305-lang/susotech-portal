import type { WorkerOperationsRow } from "@/lib/jobs/types";
import { StatCard } from "@/components/ui/stat-card";
import {
  IconActivity,
  IconChartBar,
  IconFuel,
  IconPackageCheck,
} from "@/components/ui/icons";
import { formatMoney } from "@/lib/dashboard/format";
import type { AdminDashboardPresentation } from "./admin-dashboard-presentation";

export function StatCards({
  rows,
  invoicedCents,
  presentation = "default",
}: {
  rows: WorkerOperationsRow[];
  invoicedCents: number;
  presentation?: AdminDashboardPresentation;
}) {
  const active = rows.filter((row) => row.is_shift_active).length;
  const total = rows.length;
  const productionAmount = rows.reduce(
    (sum, row) => sum + Number(row.weekly_production_amount),
    0,
  );
  const companyAmount = rows.reduce(
    (sum, row) => sum + Number(row.weekly_production_company_amount),
    0,
  );
  const fuel = rows.reduce(
    (sum, row) => sum + Number(row.weekly_fuel_amount),
    0,
  );

  const isAdmin = presentation === "admin-dashboard";

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={IconActivity}
        tone="green"
        title="Trabajadores activos"
        value={`${active} de ${total}`}
        sub={`${total} técnicos en total`}
        compact={isAdmin}
        iconPosition={isAdmin ? "right" : "left"}
      />
      <StatCard
        icon={IconChartBar}
        tone="blue"
        title="Producción semanal"
        value={formatMoney(productionAmount)}
        sub={`Compañía: ${formatMoney(companyAmount)}`}
        compact={isAdmin}
        iconPosition={isAdmin ? "right" : "left"}
      />
      <StatCard
        icon={IconPackageCheck}
        tone="amber"
        title="Facturado esta semana"
        value={formatMoney(invoicedCents / 100)}
        sub="Total facturado de todos los técnicos"
        compact={isAdmin}
        iconPosition={isAdmin ? "right" : "left"}
      />
      <StatCard
        icon={IconFuel}
        tone="emerald"
        title="Gasolina esta semana"
        value={formatMoney(fuel)}
        sub="Gasto total semanal"
        compact={isAdmin}
        iconPosition={isAdmin ? "right" : "left"}
      />
    </div>
  );
}
