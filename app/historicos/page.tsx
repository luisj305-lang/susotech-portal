import Link from "next/link";
import { AppShell } from "@/components/dashboard/app-shell";
import { Button } from "@/components/ui/button";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { requireAdmin } from "@/lib/auth/session";
import { getFinancialHistory } from "@/lib/jobs/queries";
import FinancialCharts from "@/components/historicos/financial-charts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function isoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatMoney(value: number) {
  return "$" + Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default async function HistoricosPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireAdmin();
  const values = await searchParams;
  const value = (key: string) => Array.isArray(values[key]) ? values[key][0] : values[key];
  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(defaultStart.getDate() - 30);
  const start = value("start") || isoDate(defaultStart);
  const end = value("end") || isoDate(today);
  const buckets = await getFinancialHistory(start, end);

  const income = buckets.reduce((sum, bucket) => sum + bucket.income_cents, 0) / 100;
  const workerExpense = buckets.reduce((sum, bucket) => sum + bucket.worker_expense_cents, 0) / 100;
  const fuelExpense = buckets.reduce((sum, bucket) => sum + bucket.fuel_expense_cents, 0) / 100;
  const expenses = workerExpense + fuelExpense;
  const net = income - expenses;

  return (
    <AppShell role={profile.role as "admin" | "supervisor"} userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)}>
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="text-sm font-medium text-accent-600 hover:text-accent-500">← Dashboard</Link>
        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Finanzas</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">Históricos de gastos e ingresos</h1>
          <p className="mt-2 text-ink-soft">Resumen diario de ingresos facturados, gastos de trabajadores y gasolina.</p>
        </header>
        <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4 shadow-card">
          <label className="grid gap-1 text-sm font-medium text-ink-soft">Desde<input type="date" name="start" defaultValue={start} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">Hasta<input type="date" name="end" defaultValue={end} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
          <Button variant="primary" size="md">Aplicar</Button>
        </form>
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-line bg-white p-6 shadow-card">
            <p className="text-sm font-medium text-ink-muted">Ingresos</p>
            <strong className="text-2xl text-emerald-600">{formatMoney(income)}</strong>
          </div>
          <div className="rounded-2xl border border-line bg-white p-6 shadow-card">
            <p className="text-sm font-medium text-ink-muted">Gastos</p>
            <strong className="text-2xl text-amber-600">{formatMoney(expenses)}</strong>
          </div>
          <div className="rounded-2xl border border-line bg-white p-6 shadow-card">
            <p className="text-sm font-medium text-ink-muted">Neto</p>
            <strong className={`text-2xl ${net < 0 ? "text-red-600" : "text-blue-600"}`}>{formatMoney(net)}</strong>
          </div>
        </section>
        <FinancialCharts buckets={buckets} />
        <h2 className="mb-2 mt-8 text-xl font-bold text-ink">Detalle diario</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                <th className="px-4 py-3 text-right font-semibold">Ingresos</th>
                <th className="px-4 py-3 text-right font-semibold">Trabajadores</th>
                <th className="px-4 py-3 text-right font-semibold">Gasolina</th>
                <th className="px-4 py-3 text-right font-semibold">Gastos totales</th>
                <th className="px-4 py-3 text-right font-semibold">Neto</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => {
                const incomeRow = bucket.income_cents / 100;
                const workerRow = bucket.worker_expense_cents / 100;
                const fuelRow = bucket.fuel_expense_cents / 100;
                const expensesRow = workerRow + fuelRow;
                return (
                  <tr key={bucket.bucket_date} className="border-t border-line">
                    <td className="px-4 py-3">{bucket.bucket_date}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(incomeRow)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(workerRow)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(fuelRow)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(expensesRow)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatMoney(incomeRow - expensesRow)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface-muted font-semibold text-ink">
                <td className="px-4 py-3">Totales</td>
                <td className="px-4 py-3 text-right">{formatMoney(income)}</td>
                <td className="px-4 py-3 text-right">{formatMoney(workerExpense)}</td>
                <td className="px-4 py-3 text-right">{formatMoney(fuelExpense)}</td>
                <td className="px-4 py-3 text-right">{formatMoney(expenses)}</td>
                <td className="px-4 py-3 text-right">{formatMoney(net)}</td>
              </tr>
            </tfoot>
          </table>
          {!buckets.length && <p className="p-8 text-center text-ink-muted">No hay datos en este período.</p>}
        </div>
      </div>
    </AppShell>
  );
}
