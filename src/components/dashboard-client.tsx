import Link from "next/link";
import type { CurrentProfile } from "@/lib/auth/session";
import { WORKER_SPECIALTY_LABELS } from "@/lib/auth/capabilities";
import { LogoutButton } from "@/components/logout-button";
import type { WeeklyFinancialAllocation, WeeklyProductionLine, WorkerOperationsRow } from "@/lib/jobs/types";
import { WorkerOperationsTable } from "@/components/worker-operations-table";

const roleLabels = {
  admin: "Administrador",
  supervisor: "Supervisor",
  tecnico: "Técnico",
};

export function DashboardClient({ profile, weeklyProduction = [], weeklyFinancial = [], workerOperations = [], weekOffset = 0 }: { profile: CurrentProfile; weeklyProduction?: WeeklyProductionLine[]; weeklyFinancial?: WeeklyFinancialAllocation[]; workerOperations?: WorkerOperationsRow[]; weekOffset?: number }) {
  const canCreateJobs =
    profile.role === "admin" || profile.role === "supervisor";
  const confirmed = weeklyFinancial.filter((line) => line.billing_state === "confirmed").reduce((sum, line) => sum + Number(line.allocated_cents), 0) / 100;
  const pendingAmount = weeklyFinancial.filter((line) => line.billing_state === "pending").reduce((sum, line) => sum + Number(line.allocated_cents), 0) / 100;

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1200px] space-y-5">
        <header className="rounded-[var(--radius-surface)] border border-line bg-white p-5 shadow-[var(--shadow-card-compact)] sm:p-6">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">SUSOTECH</h1>
          <h2 className="mt-1 text-lg font-semibold text-ink-soft">Dashboard</h2>
          <div className="mt-5 grid gap-1 text-sm text-ink-soft">
        {profile.full_name && <p>{profile.full_name}</p>}
        <p>{profile.email}</p>
        <p>
          Rol: <strong>{roleLabels[profile.role]}</strong>
        </p>
        {profile.role === "tecnico" && profile.worker_specialty && <p>
          Especialidad: <strong>{WORKER_SPECIALTY_LABELS[profile.worker_specialty]}</strong>
        </p>}
          </div>
        </header>

        <nav aria-label="Acciones del dashboard" className="flex flex-wrap gap-2 rounded-[var(--radius-surface)] border border-line bg-white p-4 shadow-[var(--shadow-card-compact)]">
        {canCreateJobs && (
          <Link
            href="/trabajos/nuevo"
            className="inline-flex min-h-[var(--control-height)] items-center justify-center rounded-[var(--radius-control)] border border-brand-900 bg-brand-900 px-4 text-sm font-semibold text-white shadow-[var(--shadow-control)] hover:bg-brand-950"
          >
            + Nuevo trabajo
          </Link>
        )}

        <Link
          href="/trabajos"
          className="inline-flex min-h-[var(--control-height)] items-center justify-center rounded-[var(--radius-control)] border border-brand-900 bg-white px-4 text-sm font-semibold text-brand-900 hover:bg-brand-50"
        >
          Ver trabajos
        </Link>

        <Link
          href="/manual"
          className="inline-flex min-h-[var(--control-height)] items-center justify-center rounded-[var(--radius-control)] border border-brand-900 bg-white px-4 text-sm font-semibold text-brand-900 hover:bg-brand-50"
        >
          Trabajo manual
        </Link>

        {profile.role === "tecnico" && (
          <Link
            href="/camiones/mi-camion"
            className="inline-flex min-h-[var(--control-height)] items-center justify-center rounded-[var(--radius-control)] border border-brand-900 bg-white px-4 text-sm font-semibold text-brand-900 hover:bg-brand-50"
          >
            Mi camión
          </Link>
        )}

        {canCreateJobs && <Link href="/produccion" className="inline-flex min-h-[var(--control-height)] items-center justify-center rounded-[var(--radius-control)] border border-brand-900 bg-white px-4 text-sm font-semibold text-brand-900 hover:bg-brand-50">Producción</Link>}

        {canCreateJobs && <Link href="/catalogo" className="inline-flex min-h-[var(--control-height)] items-center justify-center rounded-[var(--radius-control)] border border-brand-900 bg-white px-4 text-sm font-semibold text-brand-900 hover:bg-brand-50">Catálogo y tarifas</Link>}

        {canCreateJobs && (
          <Link
            href="/usuarios"
            className="inline-flex min-h-[var(--control-height)] items-center justify-center rounded-[var(--radius-control)] border border-brand-900 bg-white px-4 text-sm font-semibold text-brand-900 hover:bg-brand-50"
          >
            {profile.role === "admin" ? "Administrar usuarios" : "Consultar usuarios"}
          </Link>
        )}
        </nav>

        {profile.role === "tecnico" && <section className="rounded-[var(--radius-surface)] border border-line bg-white p-5 shadow-[var(--shadow-card-compact)] sm:p-6">
          <h2 className="text-xl font-bold text-ink">Producción semanal</h2>
          <nav aria-label="Navegación de semana" className="mt-3 flex flex-wrap gap-3 text-sm font-medium text-accent-600">
            <Link href={`/dashboard?week=${weekOffset - 1}`} className="hover:text-accent-500 hover:underline">← Semana anterior</Link>
            {weekOffset !== 0 ? <Link href="/dashboard" className="hover:text-accent-500 hover:underline">Semana actual</Link> : null}
            <a href={`/api/produccion/semanal/exportar?week=${weekOffset}`} className="hover:text-accent-500 hover:underline">Exportar semana</a>
          </nav>
          <p className="mt-3 text-sm text-ink-soft">{weeklyProduction[0] ? `${weeklyProduction[0].week_start} — ${weeklyProduction[0].week_end}` : "Viernes — jueves"}</p>
          <div className="mt-4 grid gap-1 text-sm text-ink-soft sm:grid-cols-2">
            <p>Confirmado: <strong className="text-ink">${confirmed.toFixed(2)}</strong></p>
            <p>Pendiente: <strong className="text-ink">${pendingAmount.toFixed(2)}</strong></p>
          </div>
          <p className="mt-2 text-sm text-ink-muted">{weeklyProduction.length} línea(s) operativas · {weeklyFinancial.length} distribución(es) financieras</p>
          {weeklyFinancial.length > 0 && <div className="mt-4 overflow-x-auto rounded-[var(--radius-control)] border border-line">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-ink-muted"><tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">PRISM</th><th className="px-3 py-2 text-right">Porcentaje</th><th className="px-3 py-2 text-right">Monto</th><th className="px-3 py-2">Estado</th></tr></thead>
              <tbody>{weeklyFinancial.map((line) => <tr key={`${line.delivery_id}-${line.job_id}`} className="border-t border-line">
                <td className="px-3 py-2">{line.allocation_date}</td>
                <td className="px-3 py-2">{line.prism_number ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{(Number(line.percentage_basis_points) / 100).toFixed(2)}%</td>
                <td className="px-3 py-2 text-right tabular-nums">${(Number(line.allocated_cents) / 100).toFixed(2)}</td>
                <td className="px-3 py-2">{line.billing_state === "confirmed" ? "Confirmado" : "Pendiente"}</td>
            </tr>)}</tbody>
          </table>
          </div>}
        </section>}

        {profile.role !== "tecnico" && <WorkerOperationsTable rows={workerOperations} />}

        <p className="text-sm text-ink-soft">Consulta y administra los trabajos disponibles según tu rol.</p>

        <LogoutButton />
      </div>
    </main>
  );
}
