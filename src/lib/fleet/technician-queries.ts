import "server-only";

import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type {
  FleetDocument,
  FleetIncident,
  FleetInsurancePolicy,
  FleetMaintenanceRecord,
  FleetOdometerReading,
  FleetVehicle,
  FleetVehicleAssignment,
} from "@/lib/fleet/types";

export type TechnicianFleetAlert = {
  tone: "neutral" | "warning" | "danger";
  label: string;
};

export type TechnicianFleetVehicle = {
  assignment: FleetVehicleAssignment;
  vehicle: FleetVehicle;
  insuranceAlert: TechnicianFleetAlert;
  maintenanceAlert: TechnicianFleetAlert;
  recentOdometer: FleetOdometerReading[];
  recentIncidents: FleetIncident[];
  recentDocuments: Array<FleetDocument & { signed_url: string | null }>;
};

export type TechnicianWeeklyOdometer = {
  available: boolean;
  required: boolean;
  completed: boolean;
  due: boolean;
  dueOn: string;
  weekStartMonday: string;
  latestReading: FleetOdometerReading | null;
};

export type TechnicianFleetWorkspace = {
  primary: TechnicianFleetVehicle | null;
  backups: TechnicianFleetVehicle[];
  weekly: TechnicianWeeklyOdometer;
};

type FleetSettingValues = {
  weekly_odometer_day: number;
  weekly_odometer_required: boolean;
  timezone: string;
};

const defaultSettings: FleetSettingValues = {
  weekly_odometer_day: 1,
  weekly_odometer_required: false,
  timezone: "America/New_York",
};

function currentDate(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: defaultSettings.timezone }).format(new Date());
  }
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysUntil(date: string, timezone: string): number {
  const today = Date.parse(`${currentDate(timezone)}T00:00:00Z`);
  return Math.ceil((Date.parse(`${date}T00:00:00Z`) - today) / 86_400_000);
}

function insuranceAlert(policies: FleetInsurancePolicy[], timezone: string): TechnicianFleetAlert {
  const active = policies
    .filter((policy) => policy.status === "active" || policy.status === "pending")
    .sort((left, right) => left.expires_on.localeCompare(right.expires_on))[0];
  if (!active) return { tone: "danger", label: "Sin póliza vigente" };
  const days = daysUntil(active.expires_on, timezone);
  if (days < 0) return { tone: "danger", label: `Seguro vencido hace ${Math.abs(days)} día(s)` };
  if (days <= 30) return { tone: days <= 7 ? "danger" : "warning", label: `Seguro vence en ${days} día(s)` };
  return { tone: "neutral", label: `Seguro hasta ${active.expires_on}` };
}

function maintenanceAlert(records: FleetMaintenanceRecord[], odometer: number, timezone: string): TechnicianFleetAlert {
  const nextDate = records.filter((record) => record.next_due_on).map((record) => record.next_due_on as string).sort()[0];
  const nextMileage = records
    .filter((record) => record.next_due_odometer_miles !== null)
    .map((record) => Number(record.next_due_odometer_miles))
    .sort((left, right) => left - right)[0];
  if (nextDate) {
    const days = daysUntil(nextDate, timezone);
    if (days < 0) return { tone: "danger", label: `Mantenimiento vencido hace ${Math.abs(days)} día(s)` };
    if (days <= 30) return { tone: days <= 7 ? "danger" : "warning", label: `Mantenimiento en ${days} día(s)` };
  }
  if (nextMileage !== undefined) {
    const remaining = nextMileage - odometer;
    if (remaining <= 0) return { tone: "danger", label: `Mantenimiento excedido por ${Math.abs(remaining)} mi` };
    if (remaining <= 1_000) return { tone: "warning", label: `Mantenimiento en ${remaining} mi` };
  }
  if (nextDate) return { tone: "neutral", label: `Próximo servicio: ${nextDate}` };
  if (nextMileage !== undefined) return { tone: "neutral", label: `Próximo servicio: ${nextMileage.toLocaleString("en-US")} mi` };
  return { tone: "neutral", label: "Sin próximo servicio programado" };
}

function weeklyStatus(
  settings: FleetSettingValues,
  hasPrimary: boolean,
  latestReading: FleetOdometerReading | null,
): TechnicianWeeklyOdometer {
  const today = currentDate(settings.timezone);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const weekStartMonday = addDays(today, -((weekday + 6) % 7));
  const weekEndSunday = addDays(weekStartMonday, 6);
  const configuredDayOffset = (settings.weekly_odometer_day + 6) % 7;
  const dueOn = addDays(weekStartMonday, configuredDayOffset);
  const completed = Boolean(
    latestReading
    && latestReading.recorded_on >= weekStartMonday
    && latestReading.recorded_on <= weekEndSunday,
  );
  return {
    available: hasPrimary,
    required: settings.weekly_odometer_required,
    completed,
    due: hasPrimary && !completed && today >= dueOn,
    dueOn,
    weekStartMonday,
    latestReading,
  };
}

export async function getMyPrimaryVehicleLabel(): Promise<string | null> {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") throw new Error("Esta vista está disponible solo para técnicos.");
  const supabase = await createClient();
  const settingsResult = await supabase.from("fleet_settings").select("weekly_odometer_day,weekly_odometer_required,timezone").eq("id", 1).maybeSingle();
  if (settingsResult.error) throw new Error("No se pudo cargar la configuración de flota.");
  const settings = (settingsResult.data ?? defaultSettings) as FleetSettingValues;
  const today = currentDate(settings.timezone);
  const assignment = await supabase.from("fleet_vehicle_assignments")
    .select("vehicle_id")
    .eq("technician_id", profile.id)
    .eq("assignment_role", "primary")
    .lte("starts_on", today)
    .or(`ends_on.is.null,ends_on.gte.${today}`)
    .maybeSingle();
  if (assignment.error) throw new Error("No se pudo verificar el camión de la jornada.");
  if (!assignment.data) return null;
  const vehicle = await supabase.from("fleet_vehicles").select("unit_number,make,model").eq("id", assignment.data.vehicle_id).maybeSingle();
  if (vehicle.error || !vehicle.data) return null;
  return `${vehicle.data.unit_number} · ${vehicle.data.make} ${vehicle.data.model}`;
}

export async function getMyFleetWorkspace(): Promise<TechnicianFleetWorkspace> {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") throw new Error("Esta vista está disponible solo para técnicos.");
  const supabase = await createClient();
  const settingsResult = await supabase.from("fleet_settings").select("weekly_odometer_day,weekly_odometer_required,timezone").eq("id", 1).maybeSingle();
  if (settingsResult.error) throw new Error("No se pudo cargar la configuración de flota.");
  const settings = (settingsResult.data ?? defaultSettings) as FleetSettingValues;
  const today = currentDate(settings.timezone);
  const assignmentsResult = await supabase.from("fleet_vehicle_assignments").select("*").eq("technician_id", profile.id).lte("starts_on", today).or(`ends_on.is.null,ends_on.gte.${today}`).order("assignment_role").order("starts_on", { ascending: false });
  if (assignmentsResult.error) throw new Error("No se pudo cargar la asignación de camiones.");
  const assignments = (assignmentsResult.data ?? []) as FleetVehicleAssignment[];
  const vehicleIds = assignments.map((assignment) => assignment.vehicle_id);
  if (vehicleIds.length === 0) {
    return { primary: null, backups: [], weekly: weeklyStatus(settings, false, null) };
  }

  const [vehiclesResult, policiesResult, maintenanceResult, odometerResult, incidentsResult, documentsResult] = await Promise.all([
    supabase.from("fleet_vehicles").select("*").in("id", vehicleIds).order("unit_number"),
    supabase.from("fleet_insurance_policies").select("*").in("vehicle_id", vehicleIds).order("expires_on"),
    supabase.from("fleet_maintenance_records").select("*").in("vehicle_id", vehicleIds).order("created_at", { ascending: false }),
    supabase.from("fleet_odometer_readings").select("*").in("vehicle_id", vehicleIds).order("recorded_on", { ascending: false }).order("created_at", { ascending: false }).limit(30),
    supabase.from("fleet_incidents").select("*").in("vehicle_id", vehicleIds).order("occurred_at", { ascending: false }).limit(20),
    supabase.from("fleet_documents").select("*").in("vehicle_id", vehicleIds).order("created_at", { ascending: false }).limit(20),
  ]);
  const firstError = [vehiclesResult, policiesResult, maintenanceResult, odometerResult, incidentsResult, documentsResult].find((result) => result.error)?.error;
  if (firstError) throw new Error("No se pudo cargar la información de los camiones asignados.");

  const vehicles = (vehiclesResult.data ?? []) as FleetVehicle[];
  const policies = (policiesResult.data ?? []) as FleetInsurancePolicy[];
  const maintenance = (maintenanceResult.data ?? []) as FleetMaintenanceRecord[];
  const odometer = (odometerResult.data ?? []) as FleetOdometerReading[];
  const incidents = (incidentsResult.data ?? []) as FleetIncident[];
  const signedDocuments = await Promise.all(((documentsResult.data ?? []) as FleetDocument[]).map(async (document) => {
    const { data } = await supabase.storage.from("fleet-documents").createSignedUrl(document.storage_path, 300);
    return { ...document, signed_url: data?.signedUrl ?? null };
  }));
  const primaryAssignment = assignments.find((assignment) => assignment.assignment_role === "primary") ?? null;
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const weekStartMonday = addDays(today, -((weekday + 6) % 7));
  const weekEndSunday = addDays(weekStartMonday, 6);
  const latestReadingResult = primaryAssignment
    ? await supabase.from("fleet_odometer_readings").select("*").eq("vehicle_id", primaryAssignment.vehicle_id).eq("submitted_by", profile.id).gte("recorded_on", weekStartMonday).lte("recorded_on", weekEndSunday).order("recorded_on", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null, error: null };
  if (latestReadingResult.error) throw new Error("No se pudo verificar el registro semanal de millaje.");
  const latestReading = latestReadingResult.data as FleetOdometerReading | null;

  const mapped = assignments.flatMap((assignment) => {
    const vehicle = vehicles.find((entry) => entry.id === assignment.vehicle_id);
    if (!vehicle) return [];
    return [{
      assignment,
      vehicle,
      insuranceAlert: insuranceAlert(policies.filter((policy) => policy.vehicle_id === vehicle.id), settings.timezone),
      maintenanceAlert: maintenanceAlert(maintenance.filter((record) => record.vehicle_id === vehicle.id), Number(vehicle.current_odometer_miles), settings.timezone),
      recentOdometer: odometer.filter((reading) => reading.vehicle_id === vehicle.id).slice(0, 5),
      recentIncidents: incidents.filter((incident) => incident.vehicle_id === vehicle.id).slice(0, 5),
      recentDocuments: signedDocuments.filter((document) => document.vehicle_id === vehicle.id).slice(0, 5),
    } satisfies TechnicianFleetVehicle];
  });

  return {
    primary: mapped.find((entry) => entry.assignment.assignment_role === "primary") ?? null,
    backups: mapped.filter((entry) => entry.assignment.assignment_role === "backup"),
    weekly: weeklyStatus(settings, Boolean(primaryAssignment), latestReading),
  };
}
