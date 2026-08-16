import Link from "next/link";
import { AppShell } from "@/components/dashboard/app-shell";
import { Button } from "@/components/ui/button";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { requireSupervisor } from "@/lib/auth/session";
import { getFinancialAllocationReport, getProductionReport } from "@/lib/jobs/queries";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function isoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export default async function ProductionPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireSupervisor();
  const values = await searchParams;
  const value = (key: string) => Array.isArray(values[key]) ? values[key][0] : values[key];
  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(defaultStart.getDate() - 30);
  const start = value("start") || isoDate(defaultStart);
  const end = value("end") || isoDate(today);
  const [rows, financial] = await Promise.all([getProductionReport(start, end), getFinancialAllocationReport(start, end)]);
  const confirmed = financial.filter((row) => row.billing_state === "confirmed").reduce((sum, row) => sum + Number(row.allocated_cents), 0) / 100;
  const pending = financial.filter((row) => row.billing_state === "pending").reduce((sum, row) => sum + Number(row.allocated_cents), 0) / 100;

  return (
    <AppShell role={profile.role as "admin" | "supervisor"} userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)}>
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="text-sm font-medium text-accent-600 hover:text-accent-500">← Dashboard</Link>
        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Operaciones</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">Producción y distribución financiera</h1>
          <p className="mt-2 text-ink-soft">Las cantidades operativas y la distribución financiera se presentan por separado.</p>
        </header>
        <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4 shadow-card">
          <label className="grid gap-1 text-sm font-medium text-ink-soft">Desde<input type="date" name="start" defaultValue={start} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">Hasta<input type="date" name="end" defaultValue={end} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
          <Button variant="primary" size="md">Aplicar</Button>
        </form>
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-white p-6 shadow-card"><p className="text-sm font-medium text-ink-muted">Confirmado</p><strong className="text-2xl text-ink">${confirmed.toFixed(2)}</strong></div>
          <div className="rounded-2xl border border-line bg-white p-6 shadow-card"><p className="text-sm font-medium text-ink-muted">Pendiente</p><strong className="text-2xl text-ink">${pending.toFixed(2)}</strong></div>
        </section>
        <h2 className="mb-2 text-xl font-bold text-ink">Producción operativa por código</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead><tr className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted"><th className="px-4 py-3 text-left font-semibold">Fecha</th><th className="px-4 py-3 text-left font-semibold">Responsable</th><th className="px-4 py-3 text-left font-semibold">Código</th><th className="px-4 py-3 text-left font-semibold">Descripción</th><th className="px-4 py-3 text-right font-semibold">Cantidad</th><th className="px-4 py-3 text-right font-semibold">Tarifa snapshot</th><th className="px-4 py-3 text-right font-semibold">Total fuente</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={`${row.production_date}-${row.technician_id}-${row.code}-${index}`} className="border-t border-line"><td className="px-4 py-3">{row.production_date}</td><td className="px-4 py-3">{row.technician_name}</td><td className="px-4 py-3 font-semibold">{row.code}</td><td className="px-4 py-3">{row.description}</td><td className="px-4 py-3 text-right">{row.quantity} {row.unit === "foot" ? "ft" : row.unit === "hour" ? "hr" : ""}</td><td className="px-4 py-3 text-right">${Number(row.unit_rate).toFixed(3)}</td><td className="px-4 py-3 text-right">${Number(row.amount).toFixed(2)}</td></tr>)}</tbody>
          </table>
          {!rows.length && <p className="p-8 text-center text-ink-muted">No hay producción en este período.</p>}
        </div>
        <h2 className="mb-2 mt-8 text-xl font-bold text-ink">Distribución financiera vigente</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead><tr className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted"><th className="px-4 py-3 text-left font-semibold">Fecha</th><th className="px-4 py-3 text-left font-semibold">PRISM</th><th className="px-4 py-3 text-left font-semibold">Participante</th><th className="px-4 py-3 text-left font-semibold">Especialidad</th><th className="px-4 py-3 text-right font-semibold">Porcentaje</th><th className="px-4 py-3 text-right font-semibold">Importe</th><th className="px-4 py-3 text-left font-semibold">Estado</th></tr></thead>
            <tbody>{financial.map((row) => <tr key={`${row.delivery_id}-${row.participant_id}`} className="border-t border-line"><td className="px-4 py-3">{row.allocation_date}</td><td className="px-4 py-3">{row.prism_number ?? "—"}</td><td className="px-4 py-3">{row.participant_name}</td><td className="px-4 py-3">{row.worker_specialty}</td><td className="px-4 py-3 text-right">{(Number(row.percentage_basis_points) / 100).toFixed(2)}%</td><td className="px-4 py-3 text-right font-semibold">${(Number(row.allocated_cents) / 100).toFixed(2)}</td><td className="px-4 py-3">{row.billing_state === "confirmed" ? "Confirmado" : "Pendiente"}</td></tr>)}</tbody>
          </table>
          {!financial.length && <p className="p-8 text-center text-ink-muted">No hay distribuciones en este período.</p>}
        </div>
      </div>
    </AppShell>
  );
}
