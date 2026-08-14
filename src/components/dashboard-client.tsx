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

export function DashboardClient({ profile, weeklyProduction = [], weeklyFinancial = [], workerOperations = [] }: { profile: CurrentProfile; weeklyProduction?: WeeklyProductionLine[]; weeklyFinancial?: WeeklyFinancialAllocation[]; workerOperations?: WorkerOperationsRow[] }) {
  const canCreateJobs =
    profile.role === "admin" || profile.role === "supervisor";
  const confirmed = weeklyFinancial.filter((line) => line.billing_state === "confirmed").reduce((sum, line) => sum + Number(line.allocated_cents), 0) / 100;
  const pendingAmount = weeklyFinancial.filter((line) => line.billing_state === "pending").reduce((sum, line) => sum + Number(line.allocated_cents), 0) / 100;

  return (
    <main style={{ minHeight: "100vh", padding: "40px" }}>
      <h1
        style={{
          fontSize: "32px",
          fontWeight: "bold",
          marginBottom: "10px",
        }}
      >
        SUSOTECH
      </h1>

      <h2 style={{ fontSize: "24px", marginBottom: "30px" }}>Dashboard</h2>

      <div style={{ marginBottom: "30px" }}>
        {profile.full_name && <p>{profile.full_name}</p>}
        <p>{profile.email}</p>
        <p>
          Rol: <strong>{roleLabels[profile.role]}</strong>
        </p>
        {profile.role === "tecnico" && profile.worker_specialty && <p>
          Especialidad: <strong>{WORKER_SPECIALTY_LABELS[profile.worker_specialty]}</strong>
        </p>}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "30px",
        }}
      >
        {canCreateJobs && (
          <Link
            href="/trabajos/nuevo"
            style={{
              padding: "12px 20px",
              border: "1px solid currentColor",
              textDecoration: "none",
            }}
          >
            + Nuevo trabajo
          </Link>
        )}

        <Link
          href="/trabajos"
          style={{
            padding: "12px 20px",
            border: "1px solid currentColor",
            textDecoration: "none",
          }}
        >
          Ver trabajos
        </Link>

        {canCreateJobs && <Link href="/produccion" style={{ padding: "12px 20px", border: "1px solid currentColor", textDecoration: "none" }}>Producción</Link>}

        {canCreateJobs && <Link href="/catalogo" style={{ padding: "12px 20px", border: "1px solid currentColor", textDecoration: "none" }}>Catálogo y tarifas</Link>}

        {canCreateJobs && (
          <Link
            href="/usuarios"
            style={{
              padding: "12px 20px",
              border: "1px solid currentColor",
              textDecoration: "none",
            }}
          >
            {profile.role === "admin" ? "Administrar usuarios" : "Consultar usuarios"}
          </Link>
        )}
      </div>

      {profile.role === "tecnico" && <section style={{ border: "1px solid currentColor", padding: "20px", marginBottom: "30px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: "bold" }}>Producción semanal</h2>
        <p>{weeklyProduction[0] ? `${weeklyProduction[0].week_start} — ${weeklyProduction[0].week_end}` : "Viernes — jueves"}</p>
        <p style={{ marginTop: "12px" }}>Confirmado: <strong>${confirmed.toFixed(2)}</strong></p>
        <p>Pendiente: <strong>${pendingAmount.toFixed(2)}</strong></p>
        <p style={{ marginTop: "8px" }}>{weeklyProduction.length} línea(s) operativas · {weeklyFinancial.length} distribución(es) financieras</p>
        {weeklyFinancial.length > 0 && <div style={{ marginTop: "16px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "520px" }}>
            <thead><tr><th style={{ padding: "8px", textAlign: "left" }}>Fecha</th><th style={{ padding: "8px", textAlign: "left" }}>PRISM</th><th style={{ padding: "8px", textAlign: "right" }}>Porcentaje</th><th style={{ padding: "8px", textAlign: "right" }}>Monto</th><th style={{ padding: "8px", textAlign: "left" }}>Estado</th></tr></thead>
            <tbody>{weeklyFinancial.map((line) => <tr key={`${line.delivery_id}-${line.job_id}`} style={{ borderTop: "1px solid currentColor" }}>
              <td style={{ padding: "8px" }}>{line.allocation_date}</td>
              <td style={{ padding: "8px" }}>{line.prism_number ?? "—"}</td>
              <td style={{ padding: "8px", textAlign: "right" }}>{(Number(line.percentage_basis_points) / 100).toFixed(2)}%</td>
              <td style={{ padding: "8px", textAlign: "right" }}>${(Number(line.allocated_cents) / 100).toFixed(2)}</td>
              <td style={{ padding: "8px" }}>{line.billing_state === "confirmed" ? "Confirmado" : "Pendiente"}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>}

      {profile.role !== "tecnico" && <WorkerOperationsTable rows={workerOperations} />}

      <p style={{ marginBottom: "30px" }}>
        Consulta y administra los trabajos disponibles según tu rol.
      </p>

      <LogoutButton />
    </main>
  );
}
