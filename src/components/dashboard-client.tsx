import Link from "next/link";
import type { CurrentProfile } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";

const roleLabels = {
  admin: "Administrador",
  supervisor: "Supervisor",
  tecnico: "Técnico",
};

export function DashboardClient({ profile }: { profile: CurrentProfile }) {
  const canCreateProjects =
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
        {canCreateProjects && (
          <button style={{ padding: "12px 20px", cursor: "pointer" }}>
            + Nuevo Proyecto
          </button>
        )}

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

      <p style={{ marginBottom: "30px" }}>Todavía no tienes proyectos.</p>

      <LogoutButton />
    </main>
  );
}
