import { TechnicianAppShell } from "@/components/dashboard/technician-app-shell";
import { TechnicianRoute } from "@/components/jobs/technician-route";
import { requireRole } from "@/lib/auth/session";
import { displayName } from "@/lib/dashboard/profile";
import { getTechnicianRouteData } from "@/lib/jobs/technician-routing-queries";

export default async function TechnicianRoutePage() {
  const profile = await requireRole("tecnico");
  const jobs = await getTechnicianRouteData();

  return (
    <TechnicianAppShell userName={displayName(profile)}>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Operaciones</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">Mi ruta</h1>
          <p className="mt-2 max-w-3xl text-ink-soft">Calcula el mejor recorrido desde tu ubicación actual hasta tus trabajos asignados.</p>
        </header>
        <div className="mt-6">
          <TechnicianRoute jobs={jobs} />
        </div>
      </div>
    </TechnicianAppShell>
  );
}
