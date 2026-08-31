import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { FleetActionForm } from "@/components/fleet/fleet-action-form";
import { FleetDocumentUploader } from "@/components/fleet/fleet-document-uploader";
import {
  deleteFleetAssignmentAction,
  deleteFleetDocumentAction,
  deleteFleetRecordAction,
  deleteFleetVehicleAction,
  endFleetAssignmentAction,
  saveFleetAssignmentAction,
  saveFleetExpenseAction,
  saveFleetIncidentAction,
  saveFleetInsurancePaymentAction,
  saveFleetInsurancePolicyAction,
  saveFleetMaintenanceAction,
  saveFleetOdometerAction,
  saveFleetDocumentMetadataAction,
  updateFleetVehicleAction,
} from "@/lib/fleet/actions";
import { getFleetVehicleAlerts, type FleetVehicleDetail } from "@/lib/fleet/queries";
import {
  FLEET_ASSIGNMENT_ROLES,
  FLEET_EXPENSE_TYPES,
  FLEET_INCIDENT_SEVERITIES,
  FLEET_INCIDENT_STATUSES,
  FLEET_MAINTENANCE_STATUSES,
  FLEET_POLICY_STATUSES,
  FLEET_VEHICLE_STATUSES,
} from "@/lib/fleet/types";

export const FLEET_TABS = [
  { value: "resumen", label: "Resumen" },
  { value: "conductores", label: "Conductores" },
  { value: "seguro", label: "Seguro" },
  { value: "mantenimiento", label: "Mantenimiento" },
  { value: "gastos", label: "Gastos" },
  { value: "documentos", label: "Documentos" },
  { value: "incidencias", label: "Incidencias" },
] as const;

export type FleetTab = (typeof FLEET_TABS)[number]["value"];

const fieldClass = "rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none";
const gridClass = "grid gap-3 sm:grid-cols-2";

function currentDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

const vehicleStatusLabels: Record<string, string> = {
  draft: "Borrador",
  active: "Activo",
  maintenance: "En mantenimiento",
  out_of_service: "Fuera de servicio",
  retired: "Retirado",
};
const assignmentRoleLabels: Record<string, string> = { primary: "Principal", backup: "Suplente" };
const policyStatusLabels: Record<string, string> = { pending: "Pendiente", active: "Activa", expired: "Vencida", cancelled: "Cancelada" };
const maintenanceStatusLabels: Record<string, string> = { scheduled: "Programado", in_progress: "En progreso", completed: "Completado", cancelled: "Cancelado" };
const expenseLabels: Record<string, string> = { registration: "Registro", toll: "Peaje", parking: "Estacionamiento", wash: "Lavado", repair: "Reparación", other: "Otro" };
const incidentSeverityLabels: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };
const incidentStatusLabels: Record<string, string> = { open: "Abierta", investigating: "Investigando", resolved: "Resuelta", closed: "Cerrada" };
const documentLabels: Record<string, string> = { registration: "Registro", insurance: "Seguro", inspection: "Inspección", maintenance: "Mantenimiento", incident: "Incidencia", receipt: "Recibo", title: "Título", other: "Otro" };
const ledgerSourceLabels: Record<string, string> = { insurance: "Seguro", maintenance: "Mantenimiento", expense: "Gasto manual", fuel: "Combustible" };

function money(cents: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents ?? 0) / 100);
}

function ledgerDescription(source: string, description: string): string {
  if (source === "fuel") return "Combustible de jornada";
  if (source === "insurance") return description.replace(/^Insurance payment:/u, "Pago de seguro:");
  if (source === "maintenance") return description.replace(/^Maintenance:/u, "Mantenimiento:");
  return description;
}

function dateTimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function TextField({ label, name, defaultValue, type = "text", required = false, maxLength, min, step }: {
  label: string; name: string; defaultValue?: string | number | null; type?: string; required?: boolean; maxLength?: number; min?: number; step?: string;
}) {
  return <label className="grid gap-1 text-sm font-medium text-ink-soft">{label}<input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} maxLength={maxLength} min={min} step={step} className={fieldClass} /></label>;
}

function TextAreaField({ label, name, defaultValue, required = false }: { label: string; name: string; defaultValue?: string | null; required?: boolean }) {
  return <label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">{label}<textarea name={name} defaultValue={defaultValue ?? ""} required={required} rows={3} maxLength={5000} className={fieldClass} /></label>;
}

function SelectField({ label, name, defaultValue, values, labels }: { label: string; name: string; defaultValue: string; values: readonly string[]; labels: Record<string, string> }) {
  return <label className="grid gap-1 text-sm font-medium text-ink-soft">{label}<select name={name} defaultValue={defaultValue} className={fieldClass}>{values.map((entry) => <option key={entry} value={entry}>{labels[entry] ?? entry}</option>)}</select></label>;
}

function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

function DeleteRecordForm({ vehicleId, recordId, kind, label = "Eliminar" }: { vehicleId: string; recordId: string; kind: string; label?: string }) {
  return <FleetActionForm action={deleteFleetRecordAction} submitLabel={label} pendingLabel="Eliminando..." destructive className="mt-3"><Hidden name="vehicle_id" value={vehicleId} /><Hidden name="record_id" value={recordId} /><Hidden name="record_kind" value={kind} /></FleetActionForm>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-muted">{children}</p>;
}

function SummarySection({ detail }: { detail: FleetVehicleDetail }) {
  const { vehicle } = detail;
  const alerts = getFleetVehicleAlerts(detail);
  return <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
    <Card>
      <CardHeader><CardTitle>Datos del camión</CardTitle></CardHeader>
      <CardContent>
        <FleetActionForm action={updateFleetVehicleAction} submitLabel="Guardar datos" className={gridClass}>
          <Hidden name="vehicle_id" value={vehicle.id} />
          <TextField label="Número de unidad" name="unit_number" defaultValue={vehicle.unit_number} required maxLength={80} />
          <SelectField label="Estado" name="status" defaultValue={vehicle.status} values={FLEET_VEHICLE_STATUSES} labels={vehicleStatusLabels} />
          <TextField label="Marca" name="make" defaultValue={vehicle.make} required />
          <TextField label="Modelo" name="model" defaultValue={vehicle.model} required />
          <TextField label="Año" name="model_year" type="number" min={1900} defaultValue={vehicle.model_year} />
          <TextField label="Color" name="color" defaultValue={vehicle.color} />
          <TextField label="VIN" name="vin" defaultValue={vehicle.vin} maxLength={17} />
          <TextField label="Matrícula" name="license_plate" defaultValue={vehicle.license_plate} />
          <TextField label="Estado de matrícula" name="license_state" defaultValue={vehicle.license_state} />
          <TextField label="Fecha de adquisición" name="acquired_on" type="date" defaultValue={vehicle.acquired_on} />
          {vehicle.status === "retired" ? <TextField label="Fecha de retiro" name="retired_on" type="date" defaultValue={vehicle.retired_on} /> : <Hidden name="retired_on" value="" />}
          <TextAreaField label="Notas" name="notes" defaultValue={vehicle.notes} />
        </FleetActionForm>
      </CardContent>
    </Card>
    <div className="grid content-start gap-4">
      <Card><CardContent className="grid gap-4 sm:grid-cols-2">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Odómetro actual</p><p className="mt-1 text-2xl font-bold text-ink">{Number(vehicle.current_odometer_miles).toLocaleString("en-US")} mi</p></div>
        <div><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Costo registrado</p><p className="mt-1 text-2xl font-bold text-ink">{money(detail.ledger.reduce((sum, row) => sum + Number(row.amount_cents), 0))}</p></div>
      </CardContent></Card>
      <Alert variant={alerts.insurance.tone === "danger" ? "danger" : alerts.insurance.tone === "warning" ? "warning" : "info"} title="Seguro">{alerts.insurance.label}</Alert>
      <Alert variant={alerts.maintenance.tone === "danger" ? "danger" : alerts.maintenance.tone === "warning" ? "warning" : "info"} title="Mantenimiento">{alerts.maintenance.label}</Alert>
      <Card><CardHeader><CardTitle>Registrar millaje</CardTitle></CardHeader><CardContent>
        <FleetActionForm action={saveFleetOdometerAction} submitLabel="Registrar lectura" resetOnSuccess className={gridClass}>
          <Hidden name="vehicle_id" value={vehicle.id} />
          <TextField label="Millas" name="reading_miles" type="number" min={0} required />
          <TextField label="Fecha" name="recorded_on" type="date" defaultValue={currentDateInput()} required />
          <TextAreaField label="Notas" name="notes" />
        </FleetActionForm>
      </CardContent></Card>
      <details className="rounded-xl border border-red-200 bg-red-50 p-4"><summary className="cursor-pointer font-semibold text-red-800">Eliminar camión</summary><p className="mt-2 text-sm text-red-700">Solo es posible cuando no quedan asignaciones, documentos ni registros relacionados.</p><FleetActionForm action={deleteFleetVehicleAction} submitLabel="Eliminar definitivamente" destructive className="mt-3"><Hidden name="vehicle_id" value={vehicle.id} /></FleetActionForm></details>
    </div>
    <Card className="xl:col-span-2"><CardHeader><CardTitle>Historial de odómetro</CardTitle></CardHeader><CardContent className="grid gap-3">
      {detail.odometer.length ? detail.odometer.map((reading) => <details key={reading.id} className="rounded-xl border border-line p-4">
        <summary className="cursor-pointer font-semibold text-ink">{Number(reading.reading_miles).toLocaleString("en-US")} mi · {reading.recorded_on} · {reading.source}</summary>
        <FleetActionForm action={saveFleetOdometerAction} submitLabel="Corregir lectura" className={`${gridClass} mt-4`}>
          <Hidden name="vehicle_id" value={vehicle.id} /><Hidden name="odometer_id" value={reading.id} />
          <TextField label="Millas" name="reading_miles" type="number" min={0} defaultValue={reading.reading_miles} required />
          <TextField label="Fecha" name="recorded_on" type="date" defaultValue={reading.recorded_on} required />
          <TextAreaField label="Notas" name="notes" defaultValue={reading.notes} />
        </FleetActionForm>
        <DeleteRecordForm vehicleId={vehicle.id} recordId={reading.id} kind="odometer" />
      </details>) : <Empty>No hay lecturas registradas.</Empty>}
    </CardContent></Card>
  </div>;
}

function DriversSection({ detail }: { detail: FleetVehicleDetail }) {
  return <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
    <Card><CardHeader><CardTitle>Asignar conductor</CardTitle></CardHeader><CardContent>
      <FleetActionForm action={saveFleetAssignmentAction} submitLabel="Asignar" resetOnSuccess className={gridClass}>
        <Hidden name="vehicle_id" value={detail.vehicle.id} />
        <label className="grid gap-1 text-sm font-medium text-ink-soft">Técnico<select name="technician_id" required className={fieldClass}><option value="">Seleccione</option>{detail.technicians.filter((entry) => entry.is_active).map((entry) => <option key={entry.id} value={entry.id}>{entry.full_name || entry.email}</option>)}</select></label>
        <SelectField label="Rol" name="assignment_role" defaultValue="backup" values={FLEET_ASSIGNMENT_ROLES} labels={assignmentRoleLabels} />
        <TextField label="Inicio" name="starts_on" type="date" defaultValue={currentDateInput()} required />
        <TextField label="Fin (opcional)" name="ends_on" type="date" />
        <TextAreaField label="Notas" name="notes" />
      </FleetActionForm>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Historial de conductores</CardTitle></CardHeader><CardContent className="grid gap-3">
      {detail.assignments.length ? detail.assignments.map((assignment) => <details key={assignment.id} className="rounded-xl border border-line p-4">
        <summary className="cursor-pointer"><span className="font-semibold text-ink">{assignment.technician_name}</span><span className="ml-2 text-sm text-ink-muted">{assignmentRoleLabels[assignment.assignment_role]} · {assignment.starts_on} a {assignment.ends_on ?? "actual"}</span></summary>
        <FleetActionForm action={saveFleetAssignmentAction} submitLabel="Guardar asignación" className={`${gridClass} mt-4`}>
          <Hidden name="assignment_id" value={assignment.id} /><Hidden name="vehicle_id" value={detail.vehicle.id} />
          <label className="grid gap-1 text-sm font-medium text-ink-soft">Técnico<select name="technician_id" defaultValue={assignment.technician_id} className={fieldClass}>{detail.technicians.map((entry) => <option key={entry.id} value={entry.id}>{entry.full_name || entry.email}{entry.is_active ? "" : " (inactivo)"}</option>)}</select></label>
          <SelectField label="Rol" name="assignment_role" defaultValue={assignment.assignment_role} values={FLEET_ASSIGNMENT_ROLES} labels={assignmentRoleLabels} />
          <TextField label="Inicio" name="starts_on" type="date" defaultValue={assignment.starts_on} required />
          <TextField label="Fin" name="ends_on" type="date" defaultValue={assignment.ends_on} />
          <TextAreaField label="Notas" name="notes" defaultValue={assignment.notes} />
        </FleetActionForm>
        {!assignment.ends_on ? <FleetActionForm action={endFleetAssignmentAction} submitLabel="Finalizar asignación" className="mt-3 flex flex-wrap items-end gap-3"><Hidden name="assignment_id" value={assignment.id} /><Hidden name="vehicle_id" value={detail.vehicle.id} /><TextField label="Último día" name="ends_on" type="date" defaultValue={currentDateInput()} required /></FleetActionForm> : null}
        <FleetActionForm action={deleteFleetAssignmentAction} submitLabel="Eliminar asignación" destructive className="mt-3"><Hidden name="assignment_id" value={assignment.id} /><Hidden name="vehicle_id" value={detail.vehicle.id} /></FleetActionForm>
      </details>) : <Empty>No hay conductores asignados.</Empty>}
    </CardContent></Card>
  </div>;
}

function PolicyForm({ detail, policyId }: { detail: FleetVehicleDetail; policyId?: string }) {
  const policy = detail.insurancePolicies.find((entry) => entry.id === policyId);
  return <FleetActionForm action={saveFleetInsurancePolicyAction} submitLabel={policy ? "Guardar póliza" : "Registrar póliza"} resetOnSuccess={!policy} className={gridClass}>
    <Hidden name="vehicle_id" value={detail.vehicle.id} />{policy ? <Hidden name="policy_id" value={policy.id} /> : null}
    <TextField label="Aseguradora" name="provider" defaultValue={policy?.provider} required />
    <TextField label="Número de póliza" name="policy_number" defaultValue={policy?.policy_number} required />
    <TextField label="Cobertura" name="coverage_type" defaultValue={policy?.coverage_type} />
    <SelectField label="Estado" name="status" defaultValue={policy?.status ?? "active"} values={FLEET_POLICY_STATUSES} labels={policyStatusLabels} />
    <TextField label="Vigente desde" name="effective_on" type="date" defaultValue={policy?.effective_on ?? currentDateInput()} required />
    <TextField label="Vence" name="expires_on" type="date" defaultValue={policy?.expires_on} required />
    <TextField label="Prima (USD)" name="premium_dollars" type="number" min={0} step="0.01" defaultValue={policy?.premium_cents == null ? "" : Number(policy.premium_cents) / 100} />
    <TextField label="Deducible (USD)" name="deductible_dollars" type="number" min={0} step="0.01" defaultValue={policy?.deductible_cents == null ? "" : Number(policy.deductible_cents) / 100} />
    <TextField label="Agente" name="agent_name" defaultValue={policy?.agent_name} />
    <TextField label="Teléfono del agente" name="agent_phone" defaultValue={policy?.agent_phone} />
    <TextAreaField label="Notas" name="notes" defaultValue={policy?.notes} />
  </FleetActionForm>;
}

function InsuranceSection({ detail }: { detail: FleetVehicleDetail }) {
  return <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
    <Card><CardHeader><CardTitle>Nueva póliza</CardTitle></CardHeader><CardContent><PolicyForm detail={detail} /></CardContent></Card>
    <Card><CardHeader><CardTitle>Pólizas y pagos</CardTitle></CardHeader><CardContent className="grid gap-4">
      {detail.insurancePolicies.length ? detail.insurancePolicies.map((policy) => {
        const payments = detail.insurancePayments.filter((payment) => payment.policy_id === policy.id);
        return <details key={policy.id} className="rounded-xl border border-line p-4"><summary className="cursor-pointer"><span className="font-semibold">{policy.provider} · {policy.policy_number}</span><span className="ml-2 text-sm text-ink-muted">{policyStatusLabels[policy.status]} · vence {policy.expires_on}</span></summary>
          <div className="mt-4 border-t border-line pt-4"><PolicyForm detail={detail} policyId={policy.id} /></div>
          <DeleteRecordForm vehicleId={detail.vehicle.id} recordId={policy.id} kind="insurance_policy" label="Eliminar póliza" />
          <div className="mt-5 rounded-xl bg-surface-muted p-4"><h4 className="font-semibold">Registrar pago</h4><FleetActionForm action={saveFleetInsurancePaymentAction} submitLabel="Registrar pago" resetOnSuccess className={`${gridClass} mt-3`}><Hidden name="vehicle_id" value={detail.vehicle.id} /><Hidden name="policy_id" value={policy.id} /><TextField label="Fecha" name="paid_on" type="date" defaultValue={currentDateInput()} required /><TextField label="Importe (USD)" name="amount_dollars" type="number" min={0} step="0.01" required /><TextField label="Método" name="payment_method" /><TextField label="Referencia" name="reference_number" /><TextAreaField label="Notas" name="notes" /></FleetActionForm></div>
          {payments.length ? <div className="mt-3 grid gap-2">{payments.map((payment) => <details key={payment.id} className="rounded-lg border border-line bg-white p-3"><summary className="cursor-pointer text-sm font-semibold">{payment.paid_on} · {money(payment.amount_cents)}</summary><FleetActionForm action={saveFleetInsurancePaymentAction} submitLabel="Guardar pago" className={`${gridClass} mt-3`}><Hidden name="payment_id" value={payment.id} /><Hidden name="policy_id" value={policy.id} /><Hidden name="vehicle_id" value={detail.vehicle.id} /><TextField label="Fecha" name="paid_on" type="date" defaultValue={payment.paid_on} required /><TextField label="Importe (USD)" name="amount_dollars" type="number" min={0} step="0.01" defaultValue={Number(payment.amount_cents) / 100} required /><TextField label="Método" name="payment_method" defaultValue={payment.payment_method} /><TextField label="Referencia" name="reference_number" defaultValue={payment.reference_number} /><TextAreaField label="Notas" name="notes" defaultValue={payment.notes} /></FleetActionForm><DeleteRecordForm vehicleId={detail.vehicle.id} recordId={payment.id} kind="insurance_payment" /></details>)}</div> : null}
        </details>;
      }) : <Empty>No hay pólizas registradas.</Empty>}
    </CardContent></Card>
  </div>;
}

function MaintenanceForm({ detail, recordId }: { detail: FleetVehicleDetail; recordId?: string }) {
  const record = detail.maintenance.find((entry) => entry.id === recordId);
  return <FleetActionForm action={saveFleetMaintenanceAction} submitLabel={record ? "Guardar mantenimiento" : "Registrar mantenimiento"} resetOnSuccess={!record} className={gridClass}><Hidden name="vehicle_id" value={detail.vehicle.id} />{record ? <Hidden name="maintenance_id" value={record.id} /> : null}<TextField label="Tipo de servicio" name="service_type" defaultValue={record?.service_type} required /><SelectField label="Estado" name="status" defaultValue={record?.status ?? "scheduled"} values={FLEET_MAINTENANCE_STATUSES} labels={maintenanceStatusLabels} /><TextField label="Programado para" name="scheduled_for" type="date" defaultValue={record?.scheduled_for} /><TextField label="Completado el" name="completed_on" type="date" defaultValue={record?.completed_on} /><TextField label="Millaje del servicio" name="odometer_miles" type="number" min={0} defaultValue={record?.odometer_miles} /><TextField label="Proveedor" name="vendor" defaultValue={record?.vendor} /><TextField label="Costo (USD)" name="cost_dollars" type="number" min={0} step="0.01" defaultValue={record ? Number(record.cost_cents) / 100 : ""} /><TextField label="Próxima fecha" name="next_due_on" type="date" defaultValue={record?.next_due_on} /><TextField label="Próximo millaje" name="next_due_odometer_miles" type="number" min={0} defaultValue={record?.next_due_odometer_miles} /><TextField label="Descripción" name="description" defaultValue={record?.description} /><TextAreaField label="Notas" name="notes" defaultValue={record?.notes} /></FleetActionForm>;
}

function MaintenanceSection({ detail }: { detail: FleetVehicleDetail }) {
  return <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]"><Card><CardHeader><CardTitle>Registrar mantenimiento</CardTitle></CardHeader><CardContent><MaintenanceForm detail={detail} /></CardContent></Card><Card><CardHeader><CardTitle>Historial y próximos servicios</CardTitle></CardHeader><CardContent className="grid gap-3">{detail.maintenance.length ? detail.maintenance.map((record) => <details key={record.id} className="rounded-xl border border-line p-4"><summary className="cursor-pointer"><span className="font-semibold">{record.service_type}</span><span className="ml-2 text-sm text-ink-muted">{maintenanceStatusLabels[record.status]} · {money(record.cost_cents)} · {record.completed_on ?? record.scheduled_for ?? "sin fecha"}</span></summary><div className="mt-4"><MaintenanceForm detail={detail} recordId={record.id} /></div><DeleteRecordForm vehicleId={detail.vehicle.id} recordId={record.id} kind="maintenance" /></details>) : <Empty>No hay mantenimientos registrados.</Empty>}</CardContent></Card></div>;
}

function ExpenseForm({ detail, expenseId }: { detail: FleetVehicleDetail; expenseId?: string }) {
  const expense = detail.expenses.find((entry) => entry.id === expenseId);
  return <FleetActionForm action={saveFleetExpenseAction} submitLabel={expense ? "Guardar gasto" : "Registrar gasto"} resetOnSuccess={!expense} className={gridClass}><Hidden name="vehicle_id" value={detail.vehicle.id} />{expense ? <Hidden name="expense_id" value={expense.id} /> : null}<SelectField label="Tipo" name="expense_type" defaultValue={expense?.expense_type ?? "other"} values={FLEET_EXPENSE_TYPES} labels={expenseLabels} /><TextField label="Fecha" name="occurred_on" type="date" defaultValue={expense?.occurred_on ?? currentDateInput()} required /><TextField label="Importe (USD)" name="amount_dollars" type="number" min={0} step="0.01" defaultValue={expense ? Number(expense.amount_cents) / 100 : ""} required /><TextField label="Proveedor" name="vendor" defaultValue={expense?.vendor} /><TextField label="Descripción" name="description" defaultValue={expense?.description} required /><TextAreaField label="Notas" name="notes" defaultValue={expense?.notes} /></FleetActionForm>;
}

function ExpensesSection({ detail }: { detail: FleetVehicleDetail }) {
  return <div className="grid gap-6"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{(["insurance", "maintenance", "expense", "fuel"] as const).map((source) => <Card key={source}><CardContent><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{ledgerSourceLabels[source]}</p><p className="mt-1 text-2xl font-bold">{money(detail.ledger.filter((row) => row.source_type === source).reduce((sum, row) => sum + Number(row.amount_cents), 0))}</p></CardContent></Card>)}</div><div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]"><Card><CardHeader><CardTitle>Nuevo gasto manual</CardTitle></CardHeader><CardContent><ExpenseForm detail={detail} /></CardContent></Card><Card><CardHeader><CardTitle>Gastos manuales</CardTitle></CardHeader><CardContent className="grid gap-3">{detail.expenses.length ? detail.expenses.map((expense) => <details key={expense.id} className="rounded-xl border border-line p-4"><summary className="cursor-pointer font-semibold">{expense.occurred_on} · {money(expense.amount_cents)} · {expense.description}</summary><div className="mt-4"><ExpenseForm detail={detail} expenseId={expense.id} /></div><DeleteRecordForm vehicleId={detail.vehicle.id} recordId={expense.id} kind="expense" /></details>) : <Empty>No hay gastos manuales.</Empty>}</CardContent></Card></div><Card><CardHeader><CardTitle>Libro de costos</CardTitle></CardHeader><CardContent>{detail.ledger.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-xs uppercase text-ink-muted"><th className="p-2">Fecha</th><th className="p-2">Origen</th><th className="p-2">Descripción</th><th className="p-2 text-right">Importe</th></tr></thead><tbody>{detail.ledger.map((row) => <tr key={`${row.source_type}-${row.source_id}`} className="border-b border-line"><td className="p-2">{row.occurred_on}</td><td className="p-2">{ledgerSourceLabels[row.source_type] ?? row.source_type}</td><td className="p-2">{ledgerDescription(row.source_type, row.description)}</td><td className="p-2 text-right font-semibold">{money(row.amount_cents)}</td></tr>)}</tbody></table></div> : <Empty>No hay costos registrados.</Empty>}</CardContent></Card></div>;
}

function DocumentsSection({ detail }: { detail: FleetVehicleDetail }) {
  return <div className="grid gap-6"><Card><CardHeader><CardTitle>Cargar documento privado</CardTitle></CardHeader><CardContent><FleetDocumentUploader vehicleId={detail.vehicle.id} /></CardContent></Card><Card><CardHeader><CardTitle>Documentos</CardTitle></CardHeader><CardContent className="grid gap-3">{detail.documents.length ? detail.documents.map((document) => <details key={document.id} className="rounded-xl border border-line p-4"><summary className="cursor-pointer"><span className="font-semibold">{document.title}</span><span className="ml-2 text-sm text-ink-muted">{documentLabels[document.document_type]} · {Math.ceil(Number(document.size_bytes) / 1024)} KB{document.expires_on ? ` · vence ${document.expires_on}` : ""}</span></summary><div className="mt-3 flex flex-wrap gap-2">{document.signed_url ? <a href={document.signed_url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary", size: "sm" })}>Abrir archivo</a> : <span className="text-sm text-red-700">Enlace no disponible</span>}</div><FleetActionForm action={saveFleetDocumentMetadataAction} submitLabel="Guardar metadatos" className={`${gridClass} mt-4`}><Hidden name="vehicle_id" value={detail.vehicle.id} /><Hidden name="document_id" value={document.id} /><TextField label="Título" name="title" defaultValue={document.title} required /><label className="grid gap-1 text-sm font-medium text-ink-soft">Tipo<select name="document_type" defaultValue={document.document_type} className={fieldClass}>{Object.entries(documentLabels).map(([entry, label]) => <option key={entry} value={entry}>{label}</option>)}</select></label><TextField label="Vence" name="expires_on" type="date" defaultValue={document.expires_on} /><TextAreaField label="Notas" name="notes" defaultValue={document.notes} /></FleetActionForm><FleetActionForm action={deleteFleetDocumentAction} submitLabel="Eliminar documento" destructive className="mt-3"><Hidden name="vehicle_id" value={detail.vehicle.id} /><Hidden name="document_id" value={document.id} /></FleetActionForm></details>) : <Empty>No hay documentos.</Empty>}</CardContent></Card></div>;
}

function IncidentForm({ detail, incidentId }: { detail: FleetVehicleDetail; incidentId?: string }) {
  const incident = detail.incidents.find((entry) => entry.id === incidentId);
  return <FleetActionForm action={saveFleetIncidentAction} submitLabel={incident ? "Guardar incidencia" : "Registrar incidencia"} resetOnSuccess={!incident} className={gridClass}><Hidden name="vehicle_id" value={detail.vehicle.id} />{incident ? <Hidden name="incident_id" value={incident.id} /> : null}<TextField label="Título" name="title" defaultValue={incident?.title} required /><TextField label="Fecha y hora" name="occurred_at" type="datetime-local" defaultValue={incident ? dateTimeLocal(incident.occurred_at) : dateTimeLocal(new Date().toISOString())} required /><SelectField label="Severidad" name="severity" defaultValue={incident?.severity ?? "medium"} values={FLEET_INCIDENT_SEVERITIES} labels={incidentSeverityLabels} /><SelectField label="Estado" name="status" defaultValue={incident?.status ?? "open"} values={FLEET_INCIDENT_STATUSES} labels={incidentStatusLabels} /><TextField label="Ubicación" name="location" defaultValue={incident?.location} /><TextField label="Millaje" name="odometer_miles" type="number" min={0} defaultValue={incident?.odometer_miles} /><TextAreaField label="Descripción" name="description" defaultValue={incident?.description} required /><TextAreaField label="Notas de resolución" name="resolution_notes" defaultValue={incident?.resolution_notes} /></FleetActionForm>;
}

function IncidentsSection({ detail }: { detail: FleetVehicleDetail }) {
  return <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]"><Card><CardHeader><CardTitle>Registrar incidencia</CardTitle></CardHeader><CardContent><IncidentForm detail={detail} /></CardContent></Card><Card><CardHeader><CardTitle>Historial de incidencias</CardTitle></CardHeader><CardContent className="grid gap-3">{detail.incidents.length ? detail.incidents.map((incident) => <details key={incident.id} className="rounded-xl border border-line p-4"><summary className="cursor-pointer"><span className="font-semibold">{incident.title}</span><span className="ml-2 text-sm text-ink-muted">{incidentStatusLabels[incident.status]} · {incidentSeverityLabels[incident.severity]} · {new Date(incident.occurred_at).toLocaleDateString("es-US")}</span></summary><p className="mt-2 text-sm text-ink-muted">Reportó: {incident.reporter_name}</p><div className="mt-4"><IncidentForm detail={detail} incidentId={incident.id} /></div><DeleteRecordForm vehicleId={detail.vehicle.id} recordId={incident.id} kind="incident" /></details>) : <Empty>No hay incidencias.</Empty>}</CardContent></Card></div>;
}

export function FleetDetailSections({ detail, activeTab }: { detail: FleetVehicleDetail; activeTab: FleetTab }) {
  return <div className="space-y-6">
    <nav aria-label="Secciones del camión" className="flex gap-2 overflow-x-auto border-b border-line pb-2">{FLEET_TABS.map((tab) => <Link key={tab.value} href={`/camiones/${detail.vehicle.id}?tab=${tab.value}`} className={tab.value === activeTab ? "whitespace-nowrap rounded-lg bg-brand-900 px-3 py-2 text-sm font-semibold text-white" : "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-muted"}>{tab.label}</Link>)}</nav>
    {activeTab === "resumen" ? <SummarySection detail={detail} /> : null}
    {activeTab === "conductores" ? <DriversSection detail={detail} /> : null}
    {activeTab === "seguro" ? <InsuranceSection detail={detail} /> : null}
    {activeTab === "mantenimiento" ? <MaintenanceSection detail={detail} /> : null}
    {activeTab === "gastos" ? <ExpensesSection detail={detail} /> : null}
    {activeTab === "documentos" ? <DocumentsSection detail={detail} /> : null}
    {activeTab === "incidencias" ? <IncidentsSection detail={detail} /> : null}
  </div>;
}
