import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/dashboard/app-shell";
import { FleetDetailSections, FLEET_TABS, type FleetTab } from "@/components/fleet/fleet-detail-sections";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireSupervisor } from "@/lib/auth/session";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { getFleetVehicleDetail } from "@/lib/fleet/queries";

const statusLabels: Record<string, string> = { draft: "Borrador", active: "Activo", maintenance: "En mantenimiento", out_of_service: "Fuera de servicio", retired: "Retirado" };

export default async function FleetDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireSupervisor();
  const { id } = await params;
  const values = await searchParams;
  const requestedTab = Array.isArray(values.tab) ? values.tab[0] : values.tab;
  const activeTab = FLEET_TABS.some((tab) => tab.value === requestedTab) ? requestedTab as FleetTab : "resumen";
  const detail = await getFleetVehicleDetail(id);
  if (!detail) notFound();

  return <AppShell role={profile.role as "admin" | "supervisor"} userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)}>
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/camiones" className="text-sm font-medium text-accent-600 hover:underline">← Volver a camiones</Link>
      <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Unidad {detail.vehicle.unit_number}</p><h1 className="text-3xl font-bold text-ink">{detail.vehicle.make} {detail.vehicle.model}</h1><p className="mt-1 text-ink-soft">{detail.vehicle.vin ? `VIN ${detail.vehicle.vin}` : "Sin VIN"} · {Number(detail.vehicle.current_odometer_miles).toLocaleString("en-US")} mi</p></div><StatusBadge status={detail.vehicle.status} label={statusLabels[detail.vehicle.status]} /></header>
      <FleetDetailSections detail={detail} activeTab={activeTab} />
    </div>
  </AppShell>;
}
