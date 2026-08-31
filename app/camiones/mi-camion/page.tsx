import { redirect } from "next/navigation";
import { TechnicianAppShell } from "@/components/dashboard/technician-app-shell";
import { TechnicianFleetWorkspace } from "@/components/fleet/technician-fleet-workspace";
import { requireProfile } from "@/lib/auth/session";
import { displayName } from "@/lib/dashboard/profile";
import { getMyFleetWorkspace } from "@/lib/fleet/technician-queries";

export default async function MyFleetVehiclePage() {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") redirect("/dashboard");
  const workspace = await getMyFleetWorkspace();

  return (
    <TechnicianAppShell userName={displayName(profile)}>
      <div className="mx-auto grid w-full max-w-[1200px] gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted">Flota</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">Mi camión</h1>
          <p className="mt-2 text-sm text-ink-soft">Consulta tus asignaciones, registra millaje y reporta incidencias.</p>
        </header>
        <TechnicianFleetWorkspace workspace={workspace} />
      </div>
    </TechnicianAppShell>
  );
}
