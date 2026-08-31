import Link from "next/link";
import { AppShell } from "@/components/dashboard/app-shell";
import { FleetActionForm } from "@/components/fleet/fleet-action-form";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClasses } from "@/components/ui/button";
import { createFleetVehicleAction, runFleetAlertsAction, saveFleetSettingsAction } from "@/lib/fleet/actions";
import { getFleetSettings, listFleetVehicles } from "@/lib/fleet/queries";
import { requireSupervisor } from "@/lib/auth/session";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { FLEET_VEHICLE_STATUSES } from "@/lib/fleet/types";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const fieldClass = "rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none";
const statusLabels: Record<string, string> = { draft: "Borrador", active: "Activo", maintenance: "En mantenimiento", out_of_service: "Fuera de servicio", retired: "Retirado" };
const weekdayLabels = ["Domingo", "Lunes", "Martes", "Mi\u00e9rcoles", "Jueves", "Viernes", "S\u00e1bado"];

function first(values: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const entry = values[key];
  return Array.isArray(entry) ? entry[0] : entry;
}

function alertClass(tone: "neutral" | "warning" | "danger"): string {
  if (tone === "danger") return "text-red-700";
  if (tone === "warning") return "text-amber-700";
  return "text-ink-muted";
}

export default async function FleetPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireSupervisor();
  const values = await searchParams;
  const query = first(values, "q") ?? "";
  const status = first(values, "status") ?? "";
  const [vehicles, settings] = await Promise.all([
    listFleetVehicles({ query, status }),
    getFleetSettings(),
  ]);

  return <AppShell role={profile.role as "admin" | "supervisor"} userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)}>
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/dashboard" className="text-sm font-medium text-accent-600 hover:underline">← Volver al dashboard</Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Operaciones</p><h1 className="text-3xl font-bold text-ink">Camiones</h1><p className="mt-1 text-ink-soft">Asignaciones, seguros, mantenimiento, gastos y documentos en un solo lugar.</p></div>
        <details className="relative"><summary className={`${buttonClasses({ variant: "primary" })} cursor-pointer list-none`}>+ Nuevo camión</summary><div className="absolute right-0 z-20 mt-2 w-[min(44rem,calc(100vw-2rem))] rounded-2xl border border-line bg-white p-5 shadow-card"><h2 className="mb-4 text-xl font-semibold">Crear camión</h2><FleetActionForm action={createFleetVehicleAction} submitLabel="Crear camión" pendingLabel="Creando..." className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-medium text-ink-soft">Número de unidad<input name="unit_number" required maxLength={80} className={fieldClass} /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Marca<input name="make" required className={fieldClass} /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Modelo<input name="model" required className={fieldClass} /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Año<input name="model_year" type="number" min={1900} max={2200} className={fieldClass} /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">VIN<input name="vin" maxLength={17} className={fieldClass} /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Matrícula<input name="license_plate" className={fieldClass} /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Estado de matrícula<input name="license_state" className={fieldClass} /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Color<input name="color" className={fieldClass} /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Fecha de adquisición<input name="acquired_on" type="date" className={fieldClass} /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Millaje inicial<input name="current_odometer_miles" type="number" min={0} className={fieldClass} /></label><label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">Notas<textarea name="notes" rows={2} maxLength={5000} className={fieldClass} /></label></FleetActionForm></div></details>
      </header>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-white p-5 shadow-card">
          <h2 className="text-lg font-semibold text-ink">Configuraci&oacute;n operativa</h2>
          <p className="mt-1 text-sm text-ink-soft">Defina el recordatorio semanal de millaje usando la zona horaria de la operaci&oacute;n.</p>
          <FleetActionForm action={saveFleetSettingsAction} submitLabel={"Guardar configuraci\u00f3n"} pendingLabel="Guardando..." className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-ink-soft">D&iacute;a de millaje semanal<select name="weekly_odometer_day" defaultValue={settings.weekly_odometer_day} className={fieldClass}>{weekdayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>
            <label className="grid gap-1 text-sm font-medium text-ink-soft">Zona horaria IANA<input name="timezone" required defaultValue={settings.timezone} placeholder="America/New_York" className={fieldClass} /></label>
            <label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">D&iacute;as de anticipaci&oacute;n<input name="alert_day_offsets" required defaultValue={settings.alert_day_offsets.join(", ")} placeholder="30, 14, 7, 0" className={fieldClass} /><span className="text-xs font-normal text-ink-muted">Entre 0 y 365 d&iacute;as, sin repetir; m&aacute;ximo 10 valores.</span></label>
            <label className="flex items-center gap-2 text-sm font-medium text-ink-soft sm:col-span-2"><input name="weekly_odometer_required" type="checkbox" value="true" defaultChecked={settings.weekly_odometer_required} className="h-4 w-4" />Marcar el recordatorio semanal como requerido</label>
          </FleetActionForm>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-card">
          <h2 className="text-lg font-semibold text-ink">Automatizaci&oacute;n de alertas</h2>
          <p className="mt-1 text-sm text-ink-soft">Genera avisos internos a 30, 14, 7 y 0 d&iacute;as. El mantenimiento por millaje avisa una sola vez al entrar en un margen de 500 mi.</p>
          <p className="mt-2 text-xs text-ink-muted">Zona activa: {settings.timezone}. D&iacute;as configurados: {settings.alert_day_offsets.join(", ")}.</p>
          <FleetActionForm action={runFleetAlertsAction} submitLabel={"Generar alertas ahora"} pendingLabel="Generando..." className="mt-4" />
        </div>
      </section>
      <form className="grid gap-3 rounded-2xl border border-line bg-white p-4 shadow-card sm:grid-cols-[1fr_14rem_auto]">
        <label className="grid gap-1 text-sm font-medium text-ink-soft">Buscar por unidad, VIN, matrícula, marca o modelo<input name="q" defaultValue={query} className={fieldClass} /></label>
        <label className="grid gap-1 text-sm font-medium text-ink-soft">Estado<select name="status" defaultValue={status} className={fieldClass}><option value="">Todos</option>{FLEET_VEHICLE_STATUSES.map((entry) => <option key={entry} value={entry}>{statusLabels[entry]}</option>)}</select></label>
        <button className={`${buttonClasses({ variant: "primary" })} self-end`}>Aplicar</button>
      </form>
      {vehicles.length ? <div className="grid gap-4 lg:grid-cols-2">{vehicles.map((vehicle) => <article key={vehicle.id} className="rounded-2xl border border-line bg-white p-5 shadow-card"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-ink-muted">Unidad {vehicle.unit_number}</p><h2 className="mt-1 text-xl font-bold text-ink">{vehicle.make} {vehicle.model}{vehicle.model_year ? ` · ${vehicle.model_year}` : ""}</h2><p className="mt-1 text-sm text-ink-soft">{vehicle.license_plate ? `${vehicle.license_state ?? ""} ${vehicle.license_plate}`.trim() : "Sin matrícula"} · {Number(vehicle.current_odometer_miles).toLocaleString("en-US")} mi</p></div><StatusBadge status={vehicle.status} label={statusLabels[vehicle.status]} /></div><dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-ink-muted">Conductor principal</dt><dd className="font-semibold">{vehicle.primary_driver_name ?? "Sin asignar"}</dd></div><div><dt className="text-ink-muted">VIN</dt><dd className="font-semibold">{vehicle.vin ?? "Sin VIN"}</dd></div><div><dt className="text-ink-muted">Seguro</dt><dd className={`font-semibold ${alertClass(vehicle.insurance_alert.tone)}`}>{vehicle.insurance_alert.label}</dd></div><div><dt className="text-ink-muted">Mantenimiento</dt><dd className={`font-semibold ${alertClass(vehicle.maintenance_alert.tone)}`}>{vehicle.maintenance_alert.label}</dd></div></dl><Link href={`/camiones/${vehicle.id}`} className={`${buttonClasses({ variant: "secondary" })} mt-5`}>Administrar camión</Link></article>)}</div> : <section className="rounded-2xl border border-dashed border-line p-10 text-center"><h2 className="font-semibold">No hay camiones que coincidan</h2><p className="mt-2 text-sm text-ink-muted">Cambie los filtros o cree el primer camión.</p></section>}
    </div>
  </AppShell>;
}
