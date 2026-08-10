import Link from "next/link";
import type { CurrentProfile } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";

const roleLabels = {
  admin: "Administrador",
  supervisor: "Supervisor",
  tecnico: "Técnico",
};

export function DashboardClient({ profile }: { profile: CurrentProfile }) {
  const canCreateJobs =
    profile.role === "admin" || profile.role === "supervisor";

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

      <p style={{ marginBottom: "30px" }}>
        Consulta y administra los trabajos disponibles según tu rol.
      </p>

      <LogoutButton />
    </main>
  );
}
