import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FleetActionForm } from "@/components/fleet/fleet-action-form";
import {
  reportMyFleetIncidentAction,
  submitMyFleetOdometerAction,
} from "@/lib/fleet/technician-actions";
import type {
  TechnicianFleetAlert,
  TechnicianFleetVehicle,
  TechnicianFleetWorkspace as TechnicianFleetWorkspaceData,
} from "@/lib/fleet/technician-queries";
import { FLEET_INCIDENT_SEVERITIES } from "@/lib/fleet/types";

const fieldClass = "min-h-[var(--control-height)] w-full rounded-[var(--radius-control)] border border-line bg-white px-3 py-2 text-sm text-ink shadow-[var(--shadow-control)] placeholder:text-ink-muted focus:border-accent-500 focus-visible:outline-none focus-visible:ring-[var(--focus-ring-width)] focus-visible:ring-accent-500 focus-visible:ring-offset-[var(--focus-ring-offset)]";
const metricClass = "rounded-[var(--radius-control)] bg-surface-muted px-3 py-2.5";
const activitySectionClass = "rounded-[var(--radius-control)] border border-line bg-white p-3";
const severityLabels: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };
const incidentStatusLabels: Record<string, string> = { open: "Abierta", investigating: "En investigación", resolved: "Resuelta", closed: "Cerrada" };
const documentLabels: Record<string, string> = { registration: "Registro", insurance: "Seguro", inspection: "Inspección", maintenance: "Mantenimiento", incident: "Incidencia", receipt: "Recibo", title: "Título", other: "Otro" };
const vehicleStatusLabels: Record<string, string> = { draft: "Borrador", active: "Activo", maintenance: "En mantenimiento", out_of_service: "Fuera de servicio", retired: "Retirado" };

function localDateTime(): string {
  const value = new Date();
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

function AlertLine({ summary }: { summary: TechnicianFleetAlert }) {
  const variant = summary.tone === "danger" ? "danger" : summary.tone === "warning" ? "warning" : "info";
  return <Alert variant={variant}>{summary.label}</Alert>;
}

function OdometerForm({ vehicle }: { vehicle: TechnicianFleetVehicle }) {
  return (
    <FleetActionForm action={submitMyFleetOdometerAction} submitLabel="Registrar millaje" resetOnSuccess className="grid gap-[var(--space-stack)]">
      <input type="hidden" name="vehicle_id" value={vehicle.vehicle.id} />
      <label className="grid gap-1 text-sm font-medium text-ink-soft">
        Millaje actual
        <input name="reading_miles" type="number" min={vehicle.vehicle.current_odometer_miles} step={1} required placeholder={String(vehicle.vehicle.current_odometer_miles)} className={fieldClass} />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">
        Nota opcional
        <textarea name="notes" rows={2} maxLength={2000} className={fieldClass} />
      </label>
    </FleetActionForm>
  );
}

function IncidentForm({ vehicle }: { vehicle: TechnicianFleetVehicle }) {
  return (
    <FleetActionForm action={reportMyFleetIncidentAction} submitLabel="Enviar incidencia" resetOnSuccess className="grid gap-[var(--space-stack)] sm:grid-cols-2">
      <input type="hidden" name="vehicle_id" value={vehicle.vehicle.id} />
      <label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">Título<input name="title" required maxLength={200} className={fieldClass} /></label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Fecha y hora<input name="occurred_at" type="datetime-local" required defaultValue={localDateTime()} className={fieldClass} /></label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Severidad<select name="severity" defaultValue="medium" className={fieldClass}>{FLEET_INCIDENT_SEVERITIES.map((severity) => <option key={severity} value={severity}>{severityLabels[severity]}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Ubicación<input name="location" maxLength={500} className={fieldClass} /></label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Millaje<input name="odometer_miles" type="number" min={0} step={1} className={fieldClass} /></label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">Descripción<textarea name="description" required rows={3} maxLength={5000} className={fieldClass} /></label>
    </FleetActionForm>
  );
}

function VehicleCard({ vehicle, heading }: { vehicle: TechnicianFleetVehicle; heading: string }) {
  const master = vehicle.vehicle;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-line bg-surface-muted/60 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">{heading}</p>
        <CardTitle className="mt-1 text-xl">{master.unit_number} · {master.make} {master.model}</CardTitle>
        <p className="mt-1 text-sm text-ink-soft">{vehicleStatusLabels[master.status]}{master.model_year ? ` · ${master.model_year}` : ""}{master.license_plate ? ` · placa ${master.license_plate}` : ""}</p>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className={metricClass}><dt className="text-xs text-ink-muted">Millaje actual</dt><dd className="mt-0.5 font-semibold text-ink">{Number(master.current_odometer_miles).toLocaleString("en-US")} mi</dd></div>
          <div className={metricClass}><dt className="text-xs text-ink-muted">VIN</dt><dd className="mt-0.5 break-all font-semibold text-ink">{master.vin ?? "No registrado"}</dd></div>
          <div className={metricClass}><dt className="text-xs text-ink-muted">Asignación desde</dt><dd className="mt-0.5 font-semibold text-ink">{vehicle.assignment.starts_on}</dd></div>
          <div className={metricClass}><dt className="text-xs text-ink-muted">Finaliza</dt><dd className="mt-0.5 font-semibold text-ink">{vehicle.assignment.ends_on ?? "Sin fecha"}</dd></div>
        </dl>
        <div className="grid gap-2 sm:grid-cols-2"><AlertLine summary={vehicle.insuranceAlert} /><AlertLine summary={vehicle.maintenanceAlert} /></div>
        <details className="rounded-[var(--radius-surface)] border border-line bg-surface-muted/40 px-4 py-2" open={vehicle.assignment.assignment_role === "primary"}>
          <summary className="flex min-h-11 cursor-pointer items-center rounded-[var(--radius-control)] text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-[var(--focus-ring-width)] focus-visible:ring-accent-500 focus-visible:ring-offset-[var(--focus-ring-offset)]">Registrar millaje</summary>
          <div className="border-t border-line py-4"><OdometerForm vehicle={vehicle} /></div>
        </details>
        <details className="rounded-[var(--radius-surface)] border border-line bg-surface-muted/40 px-4 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center rounded-[var(--radius-control)] text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-[var(--focus-ring-width)] focus-visible:ring-accent-500 focus-visible:ring-offset-[var(--focus-ring-offset)]">Reportar incidencia</summary>
          <div className="border-t border-line py-4"><IncidentForm vehicle={vehicle} /></div>
        </details>
        <div className="grid gap-3 lg:grid-cols-3">
          <section className={activitySectionClass}><h3 className="text-sm font-semibold text-ink">Lecturas recientes</h3><div className="mt-2 grid gap-2 text-sm">{vehicle.recentOdometer.length ? vehicle.recentOdometer.map((reading) => <p key={reading.id} className="rounded-[var(--radius-control)] bg-surface-muted p-2.5">{reading.recorded_on}: <strong>{Number(reading.reading_miles).toLocaleString("en-US")} mi</strong></p>) : <p className="text-ink-muted">Sin lecturas.</p>}</div></section>
          <section className={activitySectionClass}><h3 className="text-sm font-semibold text-ink">Incidencias recientes</h3><div className="mt-2 grid gap-2 text-sm">{vehicle.recentIncidents.length ? vehicle.recentIncidents.map((incident) => <p key={incident.id} className="rounded-[var(--radius-control)] bg-surface-muted p-2.5"><strong>{incident.title}</strong><br />{incidentStatusLabels[incident.status]} · {severityLabels[incident.severity]}</p>) : <p className="text-ink-muted">Sin incidencias.</p>}</div></section>
          <section className={activitySectionClass}><h3 className="text-sm font-semibold text-ink">Documentos recientes</h3><div className="mt-2 grid gap-2 text-sm">{vehicle.recentDocuments.length ? vehicle.recentDocuments.map((document) => document.signed_url ? <a key={document.id} href={document.signed_url} target="_blank" rel="noopener noreferrer" className="rounded-[var(--radius-control)] bg-surface-muted p-2.5 font-semibold underline underline-offset-2">{documentLabels[document.document_type]} · {document.title}</a> : <p key={document.id} className="rounded-[var(--radius-control)] bg-surface-muted p-2.5">{document.title} · enlace no disponible</p>) : <p className="text-ink-muted">Sin documentos.</p>}</div></section>
        </div>
      </CardContent>
    </Card>
  );
}

export function TechnicianFleetWorkspace({ workspace }: { workspace: TechnicianFleetWorkspaceData }) {
  const { weekly } = workspace;
  const weeklyVariant = weekly.completed ? "success" : weekly.due && weekly.required ? "danger" : weekly.due ? "warning" : "info";
  const weeklyMessage = !weekly.available
    ? "Sin camión principal asignado. La jornada puede iniciarse sin camión y el registro semanal no está disponible."
    : weekly.completed
      ? `Millaje semanal completado${weekly.latestReading ? `: ${Number(weekly.latestReading.reading_miles).toLocaleString("en-US")} mi` : ""}.`
      : weekly.due
        ? `${weekly.required ? "Registro obligatorio" : "Registro opcional"}: el millaje semanal está pendiente desde ${weekly.dueOn}.`
        : `El próximo registro ${weekly.required ? "obligatorio" : "opcional"} corresponde al ${weekly.dueOn}.`;
  return (
    <div className="grid gap-4 sm:gap-5">
      <Alert variant={weeklyVariant} className="shadow-[var(--shadow-soft)]">{weeklyMessage}</Alert>
      {workspace.primary ? <VehicleCard vehicle={workspace.primary} heading="Camión principal" /> : <Card className="border-dashed"><CardHeader><CardTitle>Sin camión asignado</CardTitle></CardHeader><CardContent className="pt-3"><p className="text-sm text-ink-soft">La oficina todavía no registró un camión principal para tu perfil.</p></CardContent></Card>}
      {workspace.backups.length ? <section className="grid gap-3 sm:gap-4"><h2 className="text-lg font-bold text-ink sm:text-xl">Camiones suplentes</h2>{workspace.backups.map((vehicle) => <VehicleCard key={vehicle.assignment.id} vehicle={vehicle} heading="Asignación suplente" />)}</section> : null}
    </div>
  );
}
