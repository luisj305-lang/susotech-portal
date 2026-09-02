import { redirect } from "next/navigation";
import { TechnicianAppShell } from "@/components/dashboard/technician-app-shell";
import { TechnicianFleetWorkspace } from "@/components/fleet/technician-fleet-workspace";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/session";
import { displayName } from "@/lib/dashboard/profile";
import { getMyFleetWorkspace } from "@/lib/fleet/technician-queries";

export default async function MyFleetVehiclePage() {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") redirect("/dashboard");
  const workspace = await getMyFleetWorkspace();

  return (
    <TechnicianAppShell userName={displayName(profile)}>
      <div className="mx-auto grid w-full max-w-[1200px] gap-4 px-4 py-5 sm:gap-5 sm:px-6 sm:py-6 lg:px-8">
        <PageHeader
          greeting="Flota"
          title="Mi camión"
          description="Consulta tus asignaciones, registra millaje y reporta incidencias."
        />
        <TechnicianFleetWorkspace workspace={workspace} />
      </div>
    </TechnicianAppShell>
  );
}
