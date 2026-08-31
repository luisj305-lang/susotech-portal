import "server-only";

import { requireSupervisor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type {
  FleetCostLedgerEntry,
  FleetDocument,
  FleetExpense,
  FleetIncident,
  FleetInsurancePayment,
  FleetInsurancePolicy,
  FleetMaintenanceRecord,
  FleetOdometerReading,
  FleetSettings,
  FleetVehicle,
  FleetVehicleAssignment,
  FleetVehicleStatus,
} from "@/lib/fleet/types";

type TechnicianOption = {
  id: string;
  full_name: string | null;
  email: string;
  is_active: boolean;
};

type FleetProfileOption = TechnicianOption & {
  role: string;
};

export type FleetAlertSummary = {
  tone: "neutral" | "warning" | "danger";
  label: string;
};

export type FleetVehicleListItem = FleetVehicle & {
  primary_driver_name: string | null;
  insurance_alert: FleetAlertSummary;
  maintenance_alert: FleetAlertSummary;
};

export type FleetShiftAssociation = {
  id: string;
  technician_id: string;
  vehicle_id: string | null;
  started_at: string;
  fuel_amount: string | number;
  no_fuel_today: boolean;
  technician_name: string;
  vehicle_unit_number: string | null;
};

export type FleetOperationalSettings = Pick<
  FleetSettings,
  "weekly_odometer_day" | "weekly_odometer_required" | "alert_day_offsets" | "timezone"
>;

export type FleetVehicleDetail = {
  vehicle: FleetVehicle;
  assignments: Array<FleetVehicleAssignment & { technician_name: string }>;
  technicians: TechnicianOption[];
  insurancePolicies: FleetInsurancePolicy[];
  insurancePayments: FleetInsurancePayment[];
  maintenance: FleetMaintenanceRecord[];
  odometer: FleetOdometerReading[];
  expenses: FleetExpense[];
  incidents: Array<FleetIncident & { reporter_name: string }>;
  documents: Array<FleetDocument & { signed_url: string | null }>;
  ledger: FleetCostLedgerEntry[];
  shiftAssociations: FleetShiftAssociation[];
  vehicleOptions: Array<Pick<FleetVehicle, "id" | "unit_number">>;
};

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(date: string): number {
  const today = Date.parse(`${currentDate()}T00:00:00Z`);
  return Math.ceil((Date.parse(`${date}T00:00:00Z`) - today) / 86_400_000);
}

function insuranceSummary(policies: FleetInsurancePolicy[]): FleetAlertSummary {
  const active = policies
    .filter((policy) => policy.status === "active" || policy.status === "pending")
    .sort((left, right) => left.expires_on.localeCompare(right.expires_on))[0];
  if (!active) return { tone: "danger", label: "Sin póliza vigente" };
  const days = daysUntil(active.expires_on);
  if (days < 0) return { tone: "danger", label: `Seguro vencido hace ${Math.abs(days)} día(s)` };
  if (days <= 30) return { tone: days <= 7 ? "danger" : "warning", label: `Seguro vence en ${days} día(s)` };
  return { tone: "neutral", label: `Seguro hasta ${active.expires_on}` };
}

function maintenanceSummary(records: FleetMaintenanceRecord[], odometer: number): FleetAlertSummary {
  const dueDates = records.filter((record) => record.next_due_on).map((record) => record.next_due_on as string).sort();
  const dueMiles = records.filter((record) => record.next_due_odometer_miles !== null).map((record) => Number(record.next_due_odometer_miles)).sort((a, b) => a - b);
  const date = dueDates[0];
  const mileage = dueMiles[0];
  if (date) {
    const days = daysUntil(date);
    if (days < 0) return { tone: "danger", label: `Mantenimiento vencido hace ${Math.abs(days)} día(s)` };
    if (days <= 30) return { tone: days <= 7 ? "danger" : "warning", label: `Mantenimiento en ${days} día(s)` };
  }
  if (mileage !== undefined) {
    const remaining = mileage - odometer;
    if (remaining <= 0) return { tone: "danger", label: `Mantenimiento excedido por ${Math.abs(remaining)} mi` };
    if (remaining <= 1_000) return { tone: "warning", label: `Mantenimiento en ${remaining} mi` };
  }
  if (date) return { tone: "neutral", label: `Próximo: ${date}` };
  if (mileage !== undefined) return { tone: "neutral", label: `Próximo: ${mileage.toLocaleString("en-US")} mi` };
  return { tone: "neutral", label: "Sin próximo servicio programado" };
}

export async function listFleetVehicles(input: {
  query?: string;
  status?: string;
}): Promise<FleetVehicleListItem[]> {
  await requireSupervisor();
  const supabase = await createClient();
  const today = currentDate();
  const [vehiclesResult, assignmentsResult, profilesResult, policiesResult, maintenanceResult] = await Promise.all([
    supabase.from("fleet_vehicles").select("*").order("unit_number"),
    supabase.from("fleet_vehicle_assignments").select("*").eq("assignment_role", "primary").lte("starts_on", today).or(`ends_on.is.null,ends_on.gte.${today}`),
    supabase.from("profiles").select("id,full_name,email,is_active").eq("role", "tecnico"),
    supabase.from("fleet_insurance_policies").select("*").order("expires_on"),
    supabase.from("fleet_maintenance_records").select("*").order("created_at", { ascending: false }),
  ]);
  if (vehiclesResult.error || assignmentsResult.error || profilesResult.error || policiesResult.error || maintenanceResult.error) {
    throw new Error("No se pudo cargar la flota. Verifique que la migración de camiones esté aplicada.");
  }
  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name || profile.email]));
  const assignments = assignmentsResult.data as FleetVehicleAssignment[];
  const policies = policiesResult.data as FleetInsurancePolicy[];
  const maintenance = maintenanceResult.data as FleetMaintenanceRecord[];
  const query = input.query?.trim().toLocaleLowerCase("es") ?? "";
  const status = input.status && ["draft", "active", "maintenance", "out_of_service", "retired"].includes(input.status)
    ? input.status as FleetVehicleStatus
    : null;
  return (vehiclesResult.data as FleetVehicle[])
    .filter((vehicle) => !status || vehicle.status === status)
    .filter((vehicle) => !query || [vehicle.unit_number, vehicle.vin, vehicle.license_plate, vehicle.make, vehicle.model]
      .some((entry) => entry?.toLocaleLowerCase("es").includes(query)))
    .map((vehicle) => {
      const primary = assignments.find((assignment) => assignment.vehicle_id === vehicle.id);
      return {
        ...vehicle,
        primary_driver_name: primary ? (profiles.get(primary.technician_id) ?? "Técnico no disponible") : null,
        insurance_alert: insuranceSummary(policies.filter((policy) => policy.vehicle_id === vehicle.id)),
        maintenance_alert: maintenanceSummary(maintenance.filter((record) => record.vehicle_id === vehicle.id), Number(vehicle.current_odometer_miles)),
      };
    });
}

export async function getFleetVehicleDetail(vehicleId: string): Promise<FleetVehicleDetail | null> {
  await requireSupervisor();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(vehicleId)) return null;
  const supabase = await createClient();
  const [vehicleResult, assignmentsResult, profilesResult, policiesResult, maintenanceResult, odometerResult, expensesResult, incidentsResult, documentsResult, ledgerResult, shiftsResult, vehicleOptionsResult] = await Promise.all([
    supabase.from("fleet_vehicles").select("*").eq("id", vehicleId).maybeSingle(),
    supabase.from("fleet_vehicle_assignments").select("*").eq("vehicle_id", vehicleId).order("starts_on", { ascending: false }),
    supabase.from("profiles").select("id,full_name,email,is_active,role").order("full_name"),
    supabase.from("fleet_insurance_policies").select("*").eq("vehicle_id", vehicleId).order("expires_on", { ascending: false }),
    supabase.from("fleet_maintenance_records").select("*").eq("vehicle_id", vehicleId).order("created_at", { ascending: false }),
    supabase.from("fleet_odometer_readings").select("*").eq("vehicle_id", vehicleId).order("recorded_on", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("fleet_expenses").select("*").eq("vehicle_id", vehicleId).order("occurred_on", { ascending: false }),
    supabase.from("fleet_incidents").select("*").eq("vehicle_id", vehicleId).order("occurred_at", { ascending: false }),
    supabase.from("fleet_documents").select("*").eq("vehicle_id", vehicleId).order("created_at", { ascending: false }),
    supabase.rpc("list_fleet_cost_ledger", { p_start_on: null, p_end_on: null, p_vehicle_id: vehicleId }),
    supabase.from("technician_shifts").select("id,technician_id,vehicle_id,started_at,fuel_amount,no_fuel_today").order("started_at", { ascending: false }).limit(30),
    supabase.from("fleet_vehicles").select("id,unit_number").order("unit_number"),
  ]);
  const firstError = [vehicleResult, assignmentsResult, profilesResult, policiesResult, maintenanceResult, odometerResult, expensesResult, incidentsResult, documentsResult, ledgerResult, shiftsResult, vehicleOptionsResult].find((result) => result.error)?.error;
  if (firstError) throw new Error("No se pudo cargar el detalle del camión.");
  if (!vehicleResult.data) return null;

  const policies = policiesResult.data as FleetInsurancePolicy[];
  const policyIds = policies.map((policy) => policy.id);
  const paymentsResult = policyIds.length
    ? await supabase.from("fleet_insurance_payments").select("*").in("policy_id", policyIds).order("paid_on", { ascending: false })
    : { data: [], error: null };
  if (paymentsResult.error) throw new Error("No se pudieron cargar los pagos de seguro.");

  const profiles = profilesResult.data as FleetProfileOption[];
  const technicians = profiles
    .filter((profile) => profile.role === "tecnico")
    .map(({ id, full_name, email, is_active }) => ({ id, full_name, email, is_active }));
  const names = new Map(profiles.map((profile) => [profile.id, profile.full_name || profile.email]));
  const vehicleOptions = (vehicleOptionsResult.data ?? []) as Array<Pick<FleetVehicle, "id" | "unit_number">>;
  const vehicleNames = new Map(vehicleOptions.map((vehicle) => [vehicle.id, vehicle.unit_number]));
  const documents = await Promise.all((documentsResult.data as FleetDocument[]).map(async (document) => {
    const { data } = await supabase.storage.from("fleet-documents").createSignedUrl(document.storage_path, 300);
    return { ...document, signed_url: data?.signedUrl ?? null };
  }));

  return {
    vehicle: vehicleResult.data as FleetVehicle,
    assignments: (assignmentsResult.data as FleetVehicleAssignment[]).map((assignment) => ({
      ...assignment,
      technician_name: names.get(assignment.technician_id) ?? "Técnico no disponible",
    })),
    technicians,
    insurancePolicies: policies,
    insurancePayments: paymentsResult.data as FleetInsurancePayment[],
    maintenance: maintenanceResult.data as FleetMaintenanceRecord[],
    odometer: odometerResult.data as FleetOdometerReading[],
    expenses: expensesResult.data as FleetExpense[],
    incidents: (incidentsResult.data as FleetIncident[]).map((incident) => ({
      ...incident,
      reporter_name: names.get(incident.reported_by) ?? "Usuario no disponible",
    })),
    documents,
    ledger: (ledgerResult.data ?? []) as FleetCostLedgerEntry[],
    shiftAssociations: ((shiftsResult.data ?? []) as Array<Omit<FleetShiftAssociation, "technician_name" | "vehicle_unit_number">>).map((shift) => ({
      ...shift,
      technician_name: names.get(shift.technician_id) ?? "Técnico no disponible",
      vehicle_unit_number: shift.vehicle_id ? (vehicleNames.get(shift.vehicle_id) ?? "Camión no disponible") : null,
    })),
    vehicleOptions,
  };
}

export async function getFleetSettings(): Promise<FleetOperationalSettings> {
  await requireSupervisor();
  const result = await (await createClient()).from("fleet_settings")
    .select("weekly_odometer_day,weekly_odometer_required,alert_day_offsets,timezone")
    .eq("id", 1)
    .maybeSingle();
  if (result.error) throw new Error("No se pudo cargar la configuraci\u00f3n de alertas de flota.");
  return (result.data as FleetOperationalSettings | null) ?? {
    weekly_odometer_day: 1,
    weekly_odometer_required: false,
    alert_day_offsets: [30, 14, 7, 0],
    timezone: "America/New_York",
  };
}

export function getFleetVehicleAlerts(detail: Pick<FleetVehicleDetail, "vehicle" | "insurancePolicies" | "maintenance">) {
  return {
    insurance: insuranceSummary(detail.insurancePolicies),
    maintenance: maintenanceSummary(detail.maintenance, Number(detail.vehicle.current_odometer_miles)),
  };
}
