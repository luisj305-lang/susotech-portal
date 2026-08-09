import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";

export default function AccessDeniedPage() {
  return (
    <main style={{ minHeight: "100vh", padding: "40px" }}>
      <h1 style={{ fontSize: "30px", fontWeight: "bold" }}>
        Acceso denegado
      </h1>
      <p style={{ margin: "16px 0 24px" }}>
        Tu cuenta no tiene permiso para abrir esta página o está inactiva.
      </p>
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <Link href="/dashboard">Volver al dashboard</Link>
        <LogoutButton />
      </div>
    </main>
  );
}
