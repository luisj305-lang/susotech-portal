import Link from "next/link";
import { AppShell } from "@/components/dashboard/app-shell";
import { RoutePlanner } from "@/components/jobs/route-planner";
import { requireAdmin } from "@/lib/auth/session";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { getRoutePlannerData } from "@/lib/jobs/routing-queries";

export default async function JobRoutePage() {
  const profile = await requireAdmin();
  const data = await getRoutePlannerData();
  return <AppShell role="admin" userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)}>
    <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/trabajos" className="text-sm font-medium text-accent-600 hover:text-accent-500">← Trabajos</Link>
      <header><p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Operaciones</p><h1 className="mt-1 text-3xl font-bold text-ink">Planificar ruta</h1><p className="mt-2 max-w-3xl text-ink-soft">Selecciona hasta 25 trabajos. Google ordenará las paradas desde el portal y de regreso al mismo origen.</p></header>
      <RoutePlanner candidates={data.candidates} initialOrigin={data.originAddress} />
    </div>
  </AppShell>;
}
