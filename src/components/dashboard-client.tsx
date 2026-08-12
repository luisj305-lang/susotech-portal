import Link from "next/link";
import type { CurrentProfile } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";
import type { WeeklyProductionLine } from "@/lib/jobs/types";

const roleLabels = {
  admin: "Administrador",
  supervisor: "Supervisor",
  tecnico: "Técnico",
};

export function DashboardClient({ profile, weeklyProduction = [] }: { profile: CurrentProfile; weeklyProduction?: WeeklyProductionLine[] }) {
  const canCreateJobs =
    profile.role === "admin" || profile.role === "supervisor";
  const confirmed = weeklyProduction.filter((line) => line.billing_state === "confirmed").reduce((sum, line) => sum + Number(line.amount), 0);
  const pendingAmount = weeklyProduction.filter((line) => line.billing_state === "pending").reduce((sum, line) => sum + Number(line.amount), 0);

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
            href="/equipos"
            style={{ padding: "12px 20px", border: "1px solid currentColor", textDecoration: "none" }}
          >
            Administrar equipos
          </Link>
        )}

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

        {profile.role === "admin" && (
          <Link
            href="/usuarios"
            style={{
              padding: "12px 20px",
              border: "1px solid currentColor",
              textDecoration: "none",
            }}
          >
            Administrar usuarios
          </Link>
        )}
      </div>

      {profile.role === "tecnico" && <section style={{ border: "1px solid currentColor", padding: "20px", marginBottom: "30px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: "bold" }}>Producción semanal</h2>
        <p>{weeklyProduction[0] ? `${weeklyProduction[0].week_start} — ${weeklyProduction[0].week_end}` : "Viernes — jueves"}</p>
        <p style={{ marginTop: "12px" }}>Confirmado: <strong>${confirmed.toFixed(2)}</strong></p>
        <p>Pendiente: <strong>${pendingAmount.toFixed(2)}</strong></p>
        <p style={{ marginTop: "8px" }}>{weeklyProduction.length} registro(s) de producción</p>
      </section>}

      <p style={{ marginBottom: "30px" }}>
        Consulta y administra los trabajos disponibles según tu rol.
      </p>

      <LogoutButton />
    </main>
  );
}
